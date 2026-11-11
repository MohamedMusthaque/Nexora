const app = require( "express" )();
const bodyParser = require( "body-parser" );
const Datastore = require( "nedb" );

app.use( bodyParser.json() );

module.exports = app;

// ---- Money transfers (Day End) ------------------------------------------
// Money moved from one payment method to another, e.g. at the end of the day:
// cash banked (Cash -> Bank Transfer), cash drawn from the bank (Bank Transfer
// -> Cash), card takings settled into the bank (Card -> Bank Transfer). A
// transfer moves no money in or out of the shop: the "from" method goes down
// and the "to" method goes up by the same amount (Quick Journal / Day End).
// A saved transfer can't be changed: a mistake is put right with a transfer
// the other way.

const METHODS = [ "Cash", "Card", "Bank Transfer" ];
const MAX_AMOUNT = 1000000000;
const MAX_NOTE = 300;

let transfersDB = new Datastore( {
    filename: process.env.APPDATA + "/POS/server/databases/money_transfers.db",
    autoload: true
} );

transfersDB.ensureIndex( { fieldName: "_id", unique: true } );
transfersDB.ensureIndex( { fieldName: "date" } );

let lastId = 0;
function newId() {
    lastId = Math.max( Date.now(), lastId + 1 );
    return lastId;
}

// numbered one at a time (TRF-00001, ...)
let queue = Promise.resolve();
function inSeries( task ) {
    let run = queue.then( () => new Promise( ( done ) => task( done ) ) );
    queue = run.catch( () => {} );
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

app.methods = METHODS;

// transfers dated between from and to ("YYYY-MM-DD", inclusive) - the Quick Journal
app.findBetween = function ( from, to, callback ) {
    transfersDB.find( { date: { $gte: from, $lte: to } }, callback );
};

// GET /?from=YYYY-MM-DD&to=YYYY-MM-DD (both optional)
app.get( "/", function ( req, res ) {
    let query = {};
    let from = validDate( req.query.from );
    let to = validDate( req.query.to );
    if ( from || to ) {
        query.date = {};
        if ( from ) query.date.$gte = from;
        if ( to ) query.date.$lte = to;
    }
    transfersDB.find( query ).sort( { date: -1, seq: -1 } ).exec( function ( err, list ) {
        if ( err ) return res.status( 500 ).send( "Could not load the money transfers." );
        res.send( list );
    } );
} );

app.get( "/transfer/:id", function ( req, res ) {
    transfersDB.findOne( { _id: parseInt( req.params.id ) }, function ( err, t ) {
        if ( err ) return res.status( 500 ).send( "Could not load the transfer." );
        if ( !t ) return res.status( 404 ).send( "That transfer no longer exists." );
        res.send( t );
    } );
} );

// Body: { date, from, to, amount, reference, note, created_by, created_by_id }
app.post( "/", function ( req, res ) {
    let body = req.body || {};
    let date = validDate( body.date );
    if ( !date ) return res.status( 400 ).send( "Please enter a valid date." );
    let from = String( body.from || "" );
    let to = String( body.to || "" );
    if ( !METHODS.includes( from ) || !METHODS.includes( to ) ) {
        return res.status( 400 ).send( "Please choose where the money comes from and where it goes: " + METHODS.join( ", " ) + "." );
    }
    if ( from === to ) return res.status( 400 ).send( "The money has to go to a different method than it comes from." );
    let text = String( body.amount == null ? "" : body.amount ).trim();
    let amount = Number( text );
    if ( !/^\d+(\.\d{1,2})?$/.test( text ) || !( amount > 0 ) || amount > MAX_AMOUNT ) {
        return res.status( 400 ).send( "Please enter an amount greater than 0 (e.g. 5000 or 5000.50)." );
    }

    inSeries( function ( done ) {
        transfersDB.find( {} ).sort( { seq: -1 } ).limit( 1 ).exec( function ( err, last ) {
            if ( err ) {
                done();
                return res.status( 500 ).send( "Could not save the transfer." );
            }
            let seq = ( last.length ? Number( last[0].seq ) || 0 : 0 ) + 1;
            let transfer = {
                _id: newId(),
                seq: seq,
                transfer_no: "TRF-" + String( seq ).padStart( 5, "0" ),
                date: date,
                from: from,
                to: to,
                amount: Math.round( amount * 100 ) / 100,
                reference: cleanText( body.reference, 100 ), // e.g. the bank deposit slip number
                note: cleanText( body.note, MAX_NOTE ),
                created_by: cleanText( body.created_by, 100 ),
                created_by_id: body.created_by_id || "",
                created_at: new Date().toJSON()
            };
            transfersDB.insert( transfer, function ( err, saved ) {
                done();
                if ( err ) return res.status( 500 ).send( "Could not save the transfer." );
                res.send( saved );
            } );
        } );
    } );
} );
