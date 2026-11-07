const app = require( "express" )();
const bodyParser = require( "body-parser" );
const Datastore = require( "nedb" );
const Inventory = require( "./inventory" );

app.use( bodyParser.json() );

module.exports = app;

// ---- Suppliers, Goods Received Notes (GRN) and supplier payments ----------
// A GRN records goods bought from a supplier (or a walk-in seller): the
// products, quantities and unit costs, the received date and how it was paid
// (Cash, Card, Bank Transfer or Credit). Saving a GRN adds the quantities to
// the products' stock. Credit GRNs are what the shop owes the supplier until
// it is settled with supplier payments. Paying more than is owed leaves the
// rest with the supplier as an advance, which the next GRNs from that supplier
// use up automatically before the chosen payment method.

const GRN_PAYMENT_METHODS = [ "Cash", "Bank Transfer", "Card", "Credit" ];
const PAY_METHODS = [ "Cash", "Bank Transfer", "Card" ];
const MAX_TEXT = 200;
const MAX_NOTE = 500;
const MAX_ITEMS = 200;
const MAX_QTY = 1000000;

let suppliersDB = new Datastore( {
    filename: process.env.APPDATA + "/POS/server/databases/suppliers.db",
    autoload: true
} );
let grnsDB = new Datastore( {
    filename: process.env.APPDATA + "/POS/server/databases/grns.db",
    autoload: true
} );
let supplierPaymentsDB = new Datastore( {
    filename: process.env.APPDATA + "/POS/server/databases/supplier_payments.db",
    autoload: true
} );

suppliersDB.ensureIndex( { fieldName: "_id", unique: true } );
grnsDB.ensureIndex( { fieldName: "_id", unique: true } );
grnsDB.ensureIndex( { fieldName: "supplier_id" } );
supplierPaymentsDB.ensureIndex( { fieldName: "_id", unique: true } );
supplierPaymentsDB.ensureIndex( { fieldName: "supplier_id" } );

// unique, increasing numeric ids (two saves in the same millisecond still differ)
let lastId = 0;
function newId() {
    lastId = Math.max( Date.now(), lastId + 1 );
    return lastId;
}

// Runs tasks one after another, so a GRN number or a supplier balance check
// can't be raced by a second request (e.g. from a network till).
let queue = Promise.resolve();
function inSeries( task ) {
    let run = queue.then( () => new Promise( ( done ) => task( done ) ) );
    queue = run.catch( () => {} );
}

function round2( n ) {
    return Math.round( n * 100 ) / 100;
}

function cleanText( value, max ) {
    return String( value == null ? "" : value ).trim().replace( /\s+/g, " " ).slice( 0, max );
}

function escapeRegExp( text ) {
    return text.replace( /[.*+?^${}()|[\]\\]/g, "\\$&" );
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

// Totals for one supplier from its GRNs and payments. Each supplier has one
// running position:
//   position = credit left to pay on GRNs + advance used by GRNs - payments
// above zero the shop owes the supplier (balance); below zero the supplier
// holds an advance. Owing and an advance never exist at the same time:
// payments clear what is owed first, and GRNs use the advance first.
function supplierSummary( grns, payments ) {
    let purchases = 0, creditPurchases = 0, advanceUsed = 0, paid = 0;
    grns.forEach( ( g ) => {
        let total = Number( g.total ) || 0;
        let used = Number( g.advance_used ) || 0;
        purchases += total;
        advanceUsed += used;
        if ( g.payment_method === "Credit" ) creditPurchases += total - used;
    } );
    payments.forEach( ( p ) => { paid += Number( p.amount ) || 0; } );
    let position = round2( creditPurchases + advanceUsed - paid );
    return {
        grn_count: grns.length,
        purchases: round2( purchases ),
        credit_purchases: round2( creditPurchases ),
        advance_used: round2( advanceUsed ),
        credit_paid: round2( paid ),
        position: position,
        balance: Math.max( position, 0 ), // owed to the supplier
        advance: Math.max( -position, 0 ) // held by the supplier for the next GRNs
    };
}

function supplierPosition( supplierId, callback ) {
    grnsDB.find( { supplier_id: supplierId }, function ( err, grns ) {
        if ( err ) return callback( err );
        supplierPaymentsDB.find( { supplier_id: supplierId }, function ( err, payments ) {
            if ( err ) return callback( err );
            callback( null, supplierSummary( grns, payments ).position );
        } );
    } );
}

function validateSupplier( body ) {
    let s = {
        name: cleanText( body.name, 100 ),
        contact_person: cleanText( body.contact_person, 100 ),
        phone: cleanText( body.phone, 50 ),
        email: cleanText( body.email, 100 ),
        address: cleanText( body.address, MAX_TEXT )
    };
    if ( !s.name ) return { error: "Please enter the supplier's name." };
    if ( s.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test( s.email ) ) return { error: "Please enter a valid email address, or leave it empty." };
    return { supplier: s };
}

function findSupplierByName( name, exceptId, callback ) {
    let query = { name: new RegExp( "^" + escapeRegExp( name ) + "$", "i" ) };
    if ( exceptId != null ) query._id = { $ne: exceptId };
    suppliersDB.findOne( query, callback );
}


app.get( "/", function ( req, res ) {
    res.send( "Suppliers API" );
} );


// ---- Suppliers ----

// every supplier with its purchase / credit totals
app.get( "/all", function ( req, res ) {
    suppliersDB.find( {} ).sort( { name: 1 } ).exec( function ( err, suppliers ) {
        if ( err ) return res.status( 500 ).send( "Could not load the suppliers." );
        grnsDB.find( { supplier_id: { $gt: 0 } }, { supplier_id: 1, total: 1, payment_method: 1, advance_used: 1 }, function ( err, grns ) {
            if ( err ) return res.status( 500 ).send( "Could not load the suppliers." );
            supplierPaymentsDB.find( {}, { supplier_id: 1, amount: 1 }, function ( err, payments ) {
                if ( err ) return res.status( 500 ).send( "Could not load the suppliers." );
                res.send( suppliers.map( ( s ) => Object.assign( {}, s, supplierSummary(
                    grns.filter( ( g ) => g.supplier_id === s._id ),
                    payments.filter( ( p ) => p.supplier_id === s._id )
                ) ) ) );
            } );
        } );
    } );
} );

app.post( "/supplier", function ( req, res ) {
    let v = validateSupplier( req.body || {} );
    if ( v.error ) return res.status( 400 ).send( v.error );
    findSupplierByName( v.supplier.name, null, function ( err, existing ) {
        if ( err ) return res.status( 500 ).send( "Could not save the supplier." );
        if ( existing ) return res.status( 409 ).send( "A supplier called \"" + existing.name + "\" already exists." );
        let supplier = Object.assign( { _id: newId(), created_at: new Date().toJSON() }, v.supplier );
        suppliersDB.insert( supplier, function ( err, doc ) {
            if ( err ) return res.status( 500 ).send( "Could not save the supplier." );
            res.send( doc );
        } );
    } );
} );

app.put( "/supplier/:id", function ( req, res ) {
    let id = parseInt( req.params.id );
    let v = validateSupplier( req.body || {} );
    if ( v.error ) return res.status( 400 ).send( v.error );
    findSupplierByName( v.supplier.name, id, function ( err, existing ) {
        if ( err ) return res.status( 500 ).send( "Could not save the supplier." );
        if ( existing ) return res.status( 409 ).send( "A supplier called \"" + existing.name + "\" already exists." );
        suppliersDB.update( { _id: id }, { $set: v.supplier }, {}, function ( err, n ) {
            if ( err ) return res.status( 500 ).send( "Could not save the supplier." );
            if ( !n ) return res.status( 404 ).send( "That supplier no longer exists." );
            // GRNs keep the name they were saved with; keep them in step with a rename
            grnsDB.update( { supplier_id: id }, { $set: { supplier_name: v.supplier.name } }, { multi: true }, function () {
                res.sendStatus( 200 );
            } );
        } );
    } );
} );

// only a supplier without GRNs or payments can be deleted (keeps the records whole)
app.delete( "/supplier/:id", function ( req, res ) {
    let id = parseInt( req.params.id );
    grnsDB.count( { supplier_id: id }, function ( err, grnCount ) {
        if ( err ) return res.status( 500 ).send( "Could not delete the supplier." );
        supplierPaymentsDB.count( { supplier_id: id }, function ( err, payCount ) {
            if ( err ) return res.status( 500 ).send( "Could not delete the supplier." );
            if ( grnCount || payCount ) {
                return res.status( 409 ).send(
                    "This supplier has " + grnCount + ( grnCount === 1 ? " GRN" : " GRNs" ) +
                    ( payCount ? " and " + payCount + ( payCount === 1 ? " payment" : " payments" ) : "" ) +
                    ", so it can't be deleted."
                );
            }
            suppliersDB.remove( { _id: id }, {}, function ( err ) {
                if ( err ) return res.status( 500 ).send( "Could not delete the supplier." );
                res.sendStatus( 200 );
            } );
        } );
    } );
} );

// one supplier's GRNs and payments (its "transactions"), newest first
app.get( "/transactions/:id", function ( req, res ) {
    let id = parseInt( req.params.id );
    suppliersDB.findOne( { _id: id }, function ( err, supplier ) {
        if ( err ) return res.status( 500 ).send( "Could not load the supplier." );
        if ( !supplier ) return res.status( 404 ).send( "That supplier no longer exists." );
        grnsDB.find( { supplier_id: id } ).sort( { received_date: -1, _id: -1 } ).exec( function ( err, grns ) {
            if ( err ) return res.status( 500 ).send( "Could not load the supplier's GRNs." );
            supplierPaymentsDB.find( { supplier_id: id } ).sort( { date: -1, _id: -1 } ).exec( function ( err, payments ) {
                if ( err ) return res.status( 500 ).send( "Could not load the supplier's payments." );
                res.send( {
                    supplier: Object.assign( {}, supplier, supplierSummary( grns, payments ) ),
                    grns: grns,
                    payments: payments
                } );
            } );
        } );
    } );
} );


// ---- Goods Received Notes ----

app.get( "/grns", function ( req, res ) {
    grnsDB.find( {} ).sort( { received_date: -1, _id: -1 } ).exec( function ( err, grns ) {
        if ( err ) return res.status( 500 ).send( "Could not load the GRNs." );
        res.send( grns );
    } );
} );

app.get( "/grn/:id", function ( req, res ) {
    grnsDB.findOne( { _id: parseInt( req.params.id ) }, function ( err, grn ) {
        if ( err ) return res.status( 500 ).send( "Could not load the GRN." );
        if ( !grn ) return res.status( 404 ).send( "That GRN no longer exists." );
        res.send( grn );
    } );
} );

// Body: { supplier_id (0 = walk-in seller), walk_in_name, received_date,
//         payment_method, items: [{ product_id, quantity, unit_cost }],
//         note, created_by, created_by_id }
// Each product's cost price becomes the unit cost received. A supplier's
// advance pays for the GRN first (advance_used); payment_method covers the
// rest (amount_due), or is "Advance" when the advance paid for all of it.
app.post( "/grn", function ( req, res ) {
    let body = req.body || {};

    let receivedDate = validDate( body.received_date );
    if ( !receivedDate ) return res.status( 400 ).send( "Please enter a valid received date." );

    let paymentMethod = String( body.payment_method || "" );
    if ( !GRN_PAYMENT_METHODS.includes( paymentMethod ) ) {
        return res.status( 400 ).send( "Please choose how it was paid: Cash, Bank Transfer, Card or Credit." );
    }

    let supplierId = parseInt( body.supplier_id ) || 0;
    if ( paymentMethod === "Credit" && !supplierId ) {
        return res.status( 400 ).send( "Credit is only possible with a registered supplier. Choose a supplier, or pay by Cash, Bank Transfer or Card." );
    }

    let rawItems = Array.isArray( body.items ) ? body.items : [];
    if ( !rawItems.length ) return res.status( 400 ).send( "Please add at least one product." );
    if ( rawItems.length > MAX_ITEMS ) return res.status( 400 ).send( "A GRN can have at most " + MAX_ITEMS + " products." );

    let items = [];
    for ( let i = 0; i < rawItems.length; i++ ) {
        let r = rawItems[i] || {};
        let productId = parseInt( r.product_id );
        let quantity = Number( r.quantity );
        let unitCost = Number( r.unit_cost );
        if ( !productId ) return res.status( 400 ).send( "Line " + ( i + 1 ) + ": please choose a product." );
        if ( !Number.isInteger( quantity ) || quantity < 1 || quantity > MAX_QTY ) {
            return res.status( 400 ).send( "Line " + ( i + 1 ) + ": the quantity must be a whole number of at least 1." );
        }
        if ( !isFinite( unitCost ) || unitCost < 0 ) {
            return res.status( 400 ).send( "Line " + ( i + 1 ) + ": the unit cost must be zero or more." );
        }
        items.push( { product_id: productId, quantity: quantity, unit_cost: round2( unitCost ) } );
    }

    let note = String( body.note || "" ).trim().slice( 0, MAX_NOTE );
    let createdBy = cleanText( body.created_by, 100 );

    Inventory.getProductsByIds( items.map( ( i ) => i.product_id ), function ( err, products ) {
        if ( err ) return res.status( 500 ).send( "Could not check the products." );
        for ( let i = 0; i < items.length; i++ ) {
            let p = products.find( ( x ) => x._id === items[i].product_id );
            if ( !p ) return res.status( 400 ).send( "Line " + ( i + 1 ) + ": that product no longer exists." );
            items[i].product_name = p.name;
            let barcode = p.barcode == null ? "" : String( p.barcode );
            items[i].barcode = barcode === "NaN" ? "" : barcode;
            items[i].total = round2( items[i].quantity * items[i].unit_cost );
        }

        let withSupplier = function ( callback ) {
            if ( !supplierId ) return callback( null, null, 0 );
            suppliersDB.findOne( { _id: supplierId }, function ( err, supplier ) {
                if ( err || !supplier ) return callback( err, supplier, 0 );
                supplierPosition( supplierId, function ( err, position ) {
                    callback( err, supplier, position );
                } );
            } );
        };

        // numbered and saved one at a time (GRN-00001, GRN-00002, ...), and the
        // supplier's advance can't be used twice by two GRNs at once
        inSeries( function ( done ) {
            withSupplier( function ( err, supplier, position ) {
                if ( err ) { done(); return res.status( 500 ).send( "Could not check the supplier." ); }
                if ( supplierId && !supplier ) { done(); return res.status( 400 ).send( "That supplier no longer exists. Please choose another one." ); }

                grnsDB.find( {} ).sort( { seq: -1 } ).limit( 1 ).exec( function ( err, last ) {
                    if ( err ) { done(); return res.status( 500 ).send( "Could not save the GRN." ); }
                    let seq = ( last.length ? Number( last[0].seq ) || 0 : 0 ) + 1;
                    let total = round2( items.reduce( ( s, i ) => s + i.total, 0 ) );
                    let advance = supplier ? Math.max( -position, 0 ) : 0;
                    let advanceUsed = round2( Math.min( advance, total ) );
                    let amountDue = round2( total - advanceUsed );
                    let grn = {
                        _id: newId(),
                        seq: seq,
                        grn_no: "GRN-" + String( seq ).padStart( 5, "0" ),
                        supplier_id: supplier ? supplier._id : 0,
                        supplier_name: supplier ? supplier.name : ( cleanText( body.walk_in_name, 100 ) || "Walk-in seller" ),
                        walk_in: !supplier,
                        received_date: receivedDate,
                        payment_method: amountDue > 0 ? paymentMethod : "Advance",
                        items: items,
                        item_count: items.length,
                        total_quantity: items.reduce( ( s, i ) => s + i.quantity, 0 ),
                        total: total,
                        advance_used: advanceUsed,
                        amount_due: amountDue,
                        note: note,
                        created_by: createdBy,
                        created_at: new Date().toJSON()
                    };

                    grnsDB.insert( grn, function ( err, saved ) {
                        if ( err ) { done(); return res.status( 500 ).send( "Could not save the GRN." ); }
                        // the GRN is saved; now add the goods to stock
                        Inventory.receiveGoods( items, {
                            grn_id: saved._id,
                            reference: saved.grn_no,
                            supplier: saved.supplier_name,
                            payment_method: saved.payment_method,
                            received_date: saved.received_date,
                            user: createdBy,
                            user_id: body.created_by_id || ""
                        }, function ( err ) {
                            done();
                            if ( err ) {
                                console.error( "GRN " + saved.grn_no + ": stock update failed:", err );
                                return res.status( 500 ).send( "The GRN " + saved.grn_no + " was saved, but the stock could not be updated for every product. Please check the product quantities." );
                            }
                            res.send( Object.assign( {}, saved, { advance_after: round2( advance - advanceUsed ) } ) );
                        } );
                    } );
                } );
            } );
        } );
    } );
} );


// ---- Supplier payments (settling credit GRNs, or paying in advance) ----

// Body: { supplier_id, amount, date, payment_method, note, created_by }
// The payment settles what is owed first; the rest becomes the supplier's
// advance (used by the next GRNs).
app.post( "/payments", function ( req, res ) {
    let body = req.body || {};
    let supplierId = parseInt( body.supplier_id ) || 0;
    let amount = round2( Number( body.amount ) );
    let date = validDate( body.date );
    let method = String( body.payment_method || "" );

    if ( !supplierId ) return res.status( 400 ).send( "Please choose a supplier." );
    if ( !isFinite( amount ) || amount <= 0 ) return res.status( 400 ).send( "Please enter an amount greater than zero." );
    if ( !date ) return res.status( 400 ).send( "Please enter a valid payment date." );
    if ( !PAY_METHODS.includes( method ) ) return res.status( 400 ).send( "Please choose how it was paid: Cash, Bank Transfer or Card." );

    inSeries( function ( done ) {
        suppliersDB.findOne( { _id: supplierId }, function ( err, supplier ) {
            if ( err ) { done(); return res.status( 500 ).send( "Could not save the payment." ); }
            if ( !supplier ) { done(); return res.status( 404 ).send( "That supplier no longer exists." ); }
            supplierPosition( supplierId, function ( err, position ) {
                if ( err ) { done(); return res.status( 500 ).send( "Could not save the payment." ); }
                let owed = Math.max( position, 0 );
                let toCredit = round2( Math.min( amount, owed ) );
                let payment = {
                    _id: newId(),
                    supplier_id: supplierId,
                    supplier_name: supplier.name,
                    amount: amount,
                    date: date,
                    payment_method: method,
                    to_credit: toCredit,
                    to_advance: round2( amount - toCredit ),
                    note: String( body.note || "" ).trim().slice( 0, MAX_NOTE ),
                    created_by: cleanText( body.created_by, 100 ),
                    created_at: new Date().toJSON()
                };
                supplierPaymentsDB.insert( payment, function ( err, doc ) {
                    done();
                    if ( err ) return res.status( 500 ).send( "Could not save the payment." );
                    let after = round2( position - amount );
                    res.send( Object.assign( {}, doc, {
                        balance_after: Math.max( after, 0 ),
                        advance_after: Math.max( -after, 0 )
                    } ) );
                } );
            } );
        } );
    } );
} );
