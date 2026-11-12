const app = require( "express" )();
const bodyParser = require( "body-parser" );
const Datastore = require( "nedb" );
// the same module instance server.js mounts (each .db file is opened once)
const Inventory = require( "./inventory" );

app.use( bodyParser.json() );

module.exports = app;

// ---- Stock adjustments ------------------------------------------------------
// Stock that leaves the shop without a sale or a supplier return (expired,
// damaged, lost, stolen, used in the shop, short in a stock count), or stock
// found that wasn't on record (a stock count surplus). An adjustment note
// (ADJ-00001, ...) lists the products and quantities, the reason and the
// date; saving it takes the quantities out of stock (or adds them) and values
// them at cost. Only products that track stock can be adjusted. A saved note
// can't be changed: a mistake is put right with another adjustment.

const DIRECTIONS = [ "out", "in" ];
const REASONS = {
    out: [ "Expired", "Damaged", "Lost / Missing", "Theft", "Own / Staff use", "Stock count shortage", "Other" ],
    in: [ "Stock count surplus", "Found", "Other" ]
};
const MAX_NOTE = 500;
const MAX_ITEMS = 200;
const MAX_QTY = 1000000;

let adjustmentsDB = new Datastore( {
    filename: process.env.APPDATA + "/POS/server/databases/stock_adjustments.db",
    autoload: true
} );

adjustmentsDB.ensureIndex( { fieldName: "_id", unique: true } );

let lastId = 0;
function newId() {
    lastId = Math.max( Date.now(), lastId + 1 );
    return lastId;
}

// numbered and saved one at a time, with the stock check inside
let queue = Promise.resolve();
function inSeries( task ) {
    let run = queue.then( () => new Promise( ( done ) => task( done ) ) );
    queue = run.catch( () => {} );
}

function round2( n ) {
    return Math.round( ( Number( n ) || 0 ) * 100 ) / 100;
}

function cleanText( value, max ) {
    return String( value == null ? "" : value ).trim().replace( /\s+/g, " " ).slice( 0, max );
}

// "YYYY-MM-DD" that is a real calendar date, or null
function validDate( value ) {
    let text = String( value || "" ).trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec( text );
    if ( !m ) return null;
    let d = new Date( Number( m[1] ), Number( m[2] ) - 1, Number( m[3] ) );
    if ( d.getFullYear() !== Number( m[1] ) || d.getMonth() !== Number( m[2] ) - 1 || d.getDate() !== Number( m[3] ) ) return null;
    return text;
}

app.reasons = REASONS;

app.get( "/", function ( req, res ) {
    adjustmentsDB.find( {} ).sort( { date: -1, seq: -1 } ).exec( function ( err, list ) {
        if ( err ) return res.status( 500 ).send( "Could not load the stock adjustments." );
        res.send( list );
    } );
} );

app.get( "/reasons", function ( req, res ) {
    res.send( REASONS );
} );

app.get( "/adjustment/:id", function ( req, res ) {
    adjustmentsDB.findOne( { _id: parseInt( req.params.id ) }, function ( err, adj ) {
        if ( err ) return res.status( 500 ).send( "Could not load the stock adjustment." );
        if ( !adj ) return res.status( 404 ).send( "That stock adjustment no longer exists." );
        res.send( adj );
    } );
} );

// all adjustments dated between from and to ("YYYY-MM-DD", inclusive) - the
// Quick Journal
app.findBetween = function ( from, to, callback ) {
    adjustmentsDB.find( { date: { $gte: from, $lte: to } }, callback );
};

// Body: { direction: "out" | "in", reason, date, note,
//         items: [{ product_id, quantity, batch_id? }],
//         created_by, created_by_id }
app.post( "/", function ( req, res ) {
    let body = req.body || {};
    let direction = String( body.direction || "" );
    if ( !DIRECTIONS.includes( direction ) ) return res.status( 400 ).send( "Please choose whether the stock goes down or up." );
    let reason = String( body.reason || "" );
    if ( !REASONS[direction].includes( reason ) ) {
        return res.status( 400 ).send( "Please choose a reason: " + REASONS[direction].join( ", " ) + "." );
    }
    let date = validDate( body.date );
    if ( !date ) return res.status( 400 ).send( "Please enter a valid date." );
    let note = String( body.note || "" ).trim().slice( 0, MAX_NOTE );
    if ( reason === "Other" && !note ) return res.status( 400 ).send( "Please write what happened in the note (the reason is \"Other\")." );

    let rawItems = Array.isArray( body.items ) ? body.items : [];
    if ( !rawItems.length ) return res.status( 400 ).send( "Please add at least one product." );
    if ( rawItems.length > MAX_ITEMS ) return res.status( 400 ).send( "An adjustment can have at most " + MAX_ITEMS + " products." );

    let items = [];
    for ( let i = 0; i < rawItems.length; i++ ) {
        let r = rawItems[i] || {};
        let productId = parseInt( r.product_id );
        let quantity = Number( r.quantity );
        if ( !productId ) return res.status( 400 ).send( "Line " + ( i + 1 ) + ": please choose a product." );
        if ( !Number.isInteger( quantity ) || quantity < 1 || quantity > MAX_QTY ) {
            return res.status( 400 ).send( "Line " + ( i + 1 ) + ": the quantity must be a whole number of at least 1." );
        }
        let batchId = r.batch_id === "" || r.batch_id == null ? null : Number( r.batch_id );
        items.push( { product_id: productId, quantity: quantity, batch_id: isFinite( batchId ) ? batchId : null } );
    }
    let createdBy = cleanText( body.created_by, 100 );

    inSeries( function ( done ) {
        let fail = function ( status, message ) {
            done();
            res.status( status ).send( message );
        };
        Inventory.getProductsByIds( items.map( ( i ) => i.product_id ), function ( err, products ) {
            if ( err ) return fail( 500, "Could not check the products." );
            let wanted = {};
            for ( let i = 0; i < items.length; i++ ) {
                let p = products.find( ( x ) => x._id === items[i].product_id );
                if ( !p ) return fail( 400, "Line " + ( i + 1 ) + ": that product no longer exists." );
                if ( p.stock != 1 ) return fail( 400, "Line " + ( i + 1 ) + " (" + p.name + "): this product doesn't track stock, so there's nothing to adjust." );
                items[i].product_name = Inventory.productDisplayName( p );
                let barcode = p.barcode == null ? "" : String( p.barcode );
                items[i].barcode = barcode === "NaN" ? "" : barcode;
                wanted[p._id] = ( wanted[p._id] || 0 ) + items[i].quantity;
                let stock = parseInt( p.quantity ) || 0;
                if ( direction === "out" && wanted[p._id] > stock ) {
                    return fail( 400, "Line " + ( i + 1 ) + " (" + p.name + "): only " + Math.max( stock, 0 ) + " in stock, so " + wanted[p._id] + " can't be taken out." );
                }
            }

            adjustmentsDB.find( {} ).sort( { seq: -1 } ).limit( 1 ).exec( function ( err, last ) {
                if ( err ) return fail( 500, "Could not save the stock adjustment." );
                let seq = ( last.length ? Number( last[0].seq ) || 0 : 0 ) + 1;
                let adj = {
                    _id: newId(),
                    seq: seq,
                    adj_no: "ADJ-" + String( seq ).padStart( 5, "0" ),
                    direction: direction,
                    reason: reason,
                    date: date,
                    items: items,
                    item_count: items.length,
                    total_quantity: items.reduce( ( s, i ) => s + i.quantity, 0 ),
                    total_value: 0, // filled in once the stock has moved (valued at cost)
                    note: note,
                    created_by: createdBy,
                    created_at: new Date().toJSON()
                };
                adjustmentsDB.insert( adj, function ( err, saved ) {
                    if ( err ) return fail( 500, "Could not save the stock adjustment." );
                    // the note is saved; now move the stock
                    Inventory.adjustStock( items, {
                        direction: direction,
                        adjustment_id: saved._id,
                        reference: saved.adj_no,
                        reason: reason,
                        date: date,
                        user: createdBy,
                        user_id: body.created_by_id || ""
                    }, function ( err, results ) {
                        // what each line moved, from which batches, at what cost
                        let lines = saved.items.map( function ( item, i ) {
                            let r = ( results || [] )[i];
                            if ( !r ) return item;
                            return Object.assign( {}, item, {
                                qty_before: r.qty_before,
                                qty_after: r.qty_after,
                                unit_cost: r.unit_cost,
                                value: r.value,
                                no_cost: r.no_cost,
                                batches: r.batches
                            } );
                        } );
                        let set = {
                            items: lines,
                            total_value: round2( lines.reduce( ( s, l ) => s + ( Number( l.value ) || 0 ), 0 ) ),
                            no_cost: lines.some( ( l ) => l.no_cost )
                        };
                        if ( err ) set.stock_error = true;
                        adjustmentsDB.update( { _id: saved._id }, { $set: set }, {}, function () {
                            done();
                            let result = Object.assign( {}, saved, set );
                            if ( err ) {
                                console.error( "Stock adjustment " + saved.adj_no + ": stock update failed:", err );
                                return res.status( 500 ).send( "The adjustment " + saved.adj_no + " was saved, but the stock could not be updated for every product. Please check the product quantities." );
                            }
                            res.send( result );
                        } );
                    } );
                } );
            } );
        } );
    } );
} );
