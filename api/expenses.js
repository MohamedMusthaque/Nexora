const app = require( "express" )();
const bodyParser = require( "body-parser" );
const Datastore = require( "nedb" );

app.use( bodyParser.json() );

module.exports = app;

// ---- Expenses ------------------------------------------------------------
// Expense types (e.g. Rent, Electricity, Salaries) are created first; every
// expense belongs to one type. An expense has a date, amount, expense type,
// payment method and an optional description.

const PAYMENT_METHODS = [ "Cash", "Card", "Bank Transfer" ];
const MAX_TYPE_NAME = 60;
const MAX_DESCRIPTION = 500;

let expenseTypesDB = new Datastore( {
    filename: process.env.APPDATA + "/POS/server/databases/expense_types.db",
    autoload: true
} );

let expensesDB = new Datastore( {
    filename: process.env.APPDATA + "/POS/server/databases/expenses.db",
    autoload: true
} );

expenseTypesDB.ensureIndex( { fieldName: "_id", unique: true } );
expensesDB.ensureIndex( { fieldName: "_id", unique: true } );

// unique, increasing numeric ids (two saves in the same millisecond still differ)
let lastId = 0;
function newId() {
    lastId = Math.max( Date.now(), lastId + 1 );
    return lastId;
}

function escapeRegExp( text ) {
    return text.replace( /[.*+?^${}()|[\]\\]/g, "\\$&" );
}

// finds another type with the same name (ignoring case and spaces around it)
function findTypeByName( name, exceptId, callback ) {
    let query = { name: new RegExp( "^\\s*" + escapeRegExp( name ) + "\\s*$", "i" ) };
    if ( exceptId != null ) query._id = { $ne: exceptId };
    expenseTypesDB.findOne( query, callback );
}

function cleanTypeName( body ) {
    return String( ( body && body.name ) || "" ).trim().replace( /\s+/g, " " );
}

function typeNameError( name ) {
    if ( !name ) return "Please enter a name for the expense type.";
    if ( name.length > MAX_TYPE_NAME ) return "The expense type name can be at most " + MAX_TYPE_NAME + " characters.";
    return null;
}

// checks and tidies an expense sent by the app; callback(error, expense)
function validateExpense( body, callback ) {
    body = body || {};

    let date = String( body.date || "" ).trim();
    let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec( date );
    let parsed = match ? new Date( Number( match[1] ), Number( match[2] ) - 1, Number( match[3] ) ) : null;
    if ( !parsed || parsed.getFullYear() != match[1] || parsed.getMonth() != match[2] - 1 || parsed.getDate() != match[3] ) {
        return callback( "Please enter a valid date." );
    }

    let amount = Number( body.amount );
    if ( !isFinite( amount ) || amount <= 0 ) {
        return callback( "Please enter an amount greater than zero." );
    }
    amount = Math.round( amount * 100 ) / 100;

    let paymentMethod = String( body.payment_method || "" );
    if ( !PAYMENT_METHODS.includes( paymentMethod ) ) {
        return callback( "Please choose a payment method: Cash, Card or Bank Transfer." );
    }

    let description = String( body.description || "" ).trim();
    if ( description.length > MAX_DESCRIPTION ) {
        return callback( "The description can be at most " + MAX_DESCRIPTION + " characters." );
    }

    let typeId = parseInt( body.type_id );
    if ( !typeId ) return callback( "Please choose an expense type." );

    expenseTypesDB.findOne( { _id: typeId }, function ( err, type ) {
        if ( err ) return callback( "Could not check the expense type." );
        if ( !type ) return callback( "That expense type no longer exists. Please choose another one." );
        callback( null, {
            date: date,
            amount: amount,
            type_id: typeId,
            payment_method: paymentMethod,
            description: description
        } );
    } );
}


app.get( "/", function ( req, res ) {
    res.send( "Expenses API" );
} );


// ---- Expense types ----

app.get( "/types", function ( req, res ) {
    expenseTypesDB.find( {} ).sort( { name: 1 } ).exec( function ( err, docs ) {
        if ( err ) return res.status( 500 ).send( "Could not load the expense types." );
        // how many expenses use each type (a type in use can't be deleted)
        expensesDB.find( {}, { type_id: 1 }, function ( err, expenses ) {
            if ( err ) return res.status( 500 ).send( "Could not load the expense types." );
            let counts = {};
            expenses.forEach( ( e ) => { counts[e.type_id] = ( counts[e.type_id] || 0 ) + 1; } );
            res.send( docs.map( ( t ) => Object.assign( {}, t, { expense_count: counts[t._id] || 0 } ) ) );
        } );
    } );
} );

app.post( "/types", function ( req, res ) {
    let name = cleanTypeName( req.body );
    let error = typeNameError( name );
    if ( error ) return res.status( 400 ).send( error );

    findTypeByName( name, null, function ( err, existing ) {
        if ( err ) return res.status( 500 ).send( "Could not save the expense type." );
        if ( existing ) return res.status( 409 ).send( "An expense type called \"" + existing.name + "\" already exists." );

        let type = { _id: newId(), name: name, created_at: new Date().toJSON() };
        expenseTypesDB.insert( type, function ( err, doc ) {
            if ( err ) return res.status( 500 ).send( "Could not save the expense type." );
            res.send( doc );
        } );
    } );
} );

app.put( "/types/:id", function ( req, res ) {
    let id = parseInt( req.params.id );
    let name = cleanTypeName( req.body );
    let error = typeNameError( name );
    if ( error ) return res.status( 400 ).send( error );

    findTypeByName( name, id, function ( err, existing ) {
        if ( err ) return res.status( 500 ).send( "Could not save the expense type." );
        if ( existing ) return res.status( 409 ).send( "An expense type called \"" + existing.name + "\" already exists." );

        expenseTypesDB.update( { _id: id }, { $set: { name: name } }, {}, function ( err, numReplaced ) {
            if ( err ) return res.status( 500 ).send( "Could not save the expense type." );
            if ( !numReplaced ) return res.status( 404 ).send( "That expense type no longer exists." );
            res.sendStatus( 200 );
        } );
    } );
} );

app.delete( "/types/:id", function ( req, res ) {
    let id = parseInt( req.params.id );
    expensesDB.count( { type_id: id }, function ( err, count ) {
        if ( err ) return res.status( 500 ).send( "Could not delete the expense type." );
        if ( count > 0 ) {
            return res.status( 409 ).send(
                "This expense type is used by " + count + ( count === 1 ? " expense" : " expenses" ) +
                ". Change or delete those expenses first."
            );
        }
        expenseTypesDB.remove( { _id: id }, {}, function ( err ) {
            if ( err ) return res.status( 500 ).send( "Could not delete the expense type." );
            res.sendStatus( 200 );
        } );
    } );
} );


// ---- Expenses ----

// newest first
app.get( "/all", function ( req, res ) {
    expensesDB.find( {} ).sort( { date: -1, _id: -1 } ).exec( function ( err, docs ) {
        if ( err ) return res.status( 500 ).send( "Could not load the expenses." );
        res.send( docs );
    } );
} );

app.post( "/", function ( req, res ) {
    validateExpense( req.body, function ( error, expense ) {
        if ( error ) return res.status( 400 ).send( error );
        expense._id = newId();
        expense.created_at = new Date().toJSON();
        expense.created_by = String( req.body.created_by || "" ).slice( 0, 100 );
        expensesDB.insert( expense, function ( err, doc ) {
            if ( err ) return res.status( 500 ).send( "Could not save the expense." );
            res.send( doc );
        } );
    } );
} );

app.put( "/:id", function ( req, res ) {
    let id = parseInt( req.params.id );
    validateExpense( req.body, function ( error, expense ) {
        if ( error ) return res.status( 400 ).send( error );
        expense.updated_at = new Date().toJSON();
        expense.updated_by = String( req.body.updated_by || "" ).slice( 0, 100 );
        expensesDB.update( { _id: id }, { $set: expense }, {}, function ( err, numReplaced ) {
            if ( err ) return res.status( 500 ).send( "Could not save the expense." );
            if ( !numReplaced ) return res.status( 404 ).send( "That expense no longer exists." );
            res.sendStatus( 200 );
        } );
    } );
} );

app.delete( "/:id", function ( req, res ) {
    expensesDB.remove( { _id: parseInt( req.params.id ) }, {}, function ( err ) {
        if ( err ) return res.status( 500 ).send( "Could not delete the expense." );
        res.sendStatus( 200 );
    } );
} );


// ---- Quick Journal (journal.js) ----
// Expenses dated fromDay..toDay ("YYYY-MM-DD"), each with its type's name. Read only.
app.journalData = function ( fromDay, toDay, callback ) {
    expensesDB.find( { date: { $gte: fromDay, $lte: toDay } }, function ( err, expenses ) {
        if ( err ) return callback( err );
        expenseTypesDB.find( {}, function ( err, types ) {
            if ( err ) return callback( err );
            let names = {};
            ( types || [] ).forEach( ( t ) => { names[t._id] = t.name; } );
            callback( null, ( expenses || [] ).map( ( e ) => Object.assign( { type_name: names[e.type_id] || "" }, e ) ) );
        } );
    } );
};
