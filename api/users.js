const app = require( "express")();
const server = require( "http" ).Server( app );
const bodyParser = require( "body-parser" );
const Datastore = require( "nedb" );
const btoa = require('btoa');
app.use( bodyParser.json() );

module.exports = app;

 
let usersDB = new Datastore( {
    filename: process.env.APPDATA+"/POS/server/databases/users.db",
    autoload: true
} );


usersDB.ensureIndex({ fieldName: '_id', unique: true });


app.get( "/", function ( req, res ) {
    res.send( "Users API" );
} );


  
app.get( "/user/:userId", function ( req, res ) {
    if ( !req.params.userId ) {
        res.status( 500 ).send( "ID field is required." );
    }
    else{
    usersDB.findOne( {
        _id: parseInt(req.params.userId)
}, function ( err, docs ) {
        res.send( docs );
    } );
    }
} );



app.get( "/logout/:userId", function ( req, res ) {
    if ( !req.params.userId ) {
        res.status( 500 ).send( "ID field is required." );
    }
    else{ usersDB.update( {
            _id: parseInt(req.params.userId)
        }, {
            $set: {
                status: 'Logged Out_'+ new Date()
            }
        }, {},
    );

    res.sendStatus( 200 );
 
    }
});



app.post( "/login", function ( req, res ) {  
    usersDB.findOne( {
        username: req.body.username,
        password: btoa(req.body.password)

}, function ( err, docs ) {
        if(docs) {
            usersDB.update( {
                _id: docs._id
            }, {
                $set: {
                    status: 'Logged In_'+ new Date()
                }
            }, {},
            
        );
        }
        res.send( docs );
    } );
    
} );




app.get( "/all", function ( req, res ) {
    usersDB.find( {}, function ( err, docs ) {
        res.send( docs );
    } );
} );



app.delete( "/user/:userId", function ( req, res ) {
    usersDB.remove( {
        _id: parseInt(req.params.userId)
    }, function ( err, numRemoved ) {
        if ( err ) res.status( 500 ).send( err );
        else res.sendStatus( 200 );
    } );
} );

 
app.post( "/post" , function ( req, res ) {   
    let User = { 
            "username": req.body.username,
            "password": btoa(req.body.password),
            "fullname": req.body.fullname,
            "perm_products": req.body.perm_products == "on" ? 1 : 0,
            "perm_categories": req.body.perm_categories == "on" ? 1 : 0,
            "perm_transactions": req.body.perm_transactions == "on" ? 1 : 0,
            "perm_returns": req.body.perm_returns == "on" ? 1 : 0,
            "perm_users": req.body.perm_users == "on" ? 1 : 0,
            "perm_history": req.body.perm_history == "on" ? 1 : 0,
            "perm_settings": req.body.perm_settings == "on" ? 1 : 0,
            "perm_profit": req.body.perm_profit == "on" ? 1 : 0,
            "perm_expenses": req.body.perm_expenses == "on" ? 1 : 0,
            "perm_suppliers": req.body.perm_suppliers == "on" ? 1 : 0,
            "perm_journal": req.body.perm_journal == "on" ? 1 : 0,
            "status": ""
          }

    if(req.body.id == "") { 
       User._id = Math.floor(Date.now() / 1000);
       usersDB.insert( User, function ( err, user ) {
            if ( err ) res.status( 500 ).send( req );
            else res.send( user );
        });
    }
    else {
        let isBootstrapAdmin = parseInt(req.body.id) === 1;
        usersDB.update( {
            _id: parseInt(req.body.id)
                    }, {
                        $set: {
                            username: req.body.username,
                            password: btoa(req.body.password),
                            fullname: req.body.fullname,
                            perm_products: isBootstrapAdmin || req.body.perm_products == "on" ? 1 : 0,
                            perm_categories: isBootstrapAdmin || req.body.perm_categories == "on" ? 1 : 0,
                            perm_transactions: isBootstrapAdmin || req.body.perm_transactions == "on" ? 1 : 0,
                            perm_returns: isBootstrapAdmin || req.body.perm_returns == "on" ? 1 : 0,
                            perm_users: isBootstrapAdmin || req.body.perm_users == "on" ? 1 : 0,
                            perm_history: isBootstrapAdmin || req.body.perm_history == "on" ? 1 : 0,
                            perm_settings: isBootstrapAdmin || req.body.perm_settings == "on" ? 1 : 0,
                            perm_profit: isBootstrapAdmin || req.body.perm_profit == "on" ? 1 : 0,
                            perm_expenses: isBootstrapAdmin || req.body.perm_expenses == "on" ? 1 : 0,
                            perm_suppliers: isBootstrapAdmin || req.body.perm_suppliers == "on" ? 1 : 0,
                            perm_journal: isBootstrapAdmin || req.body.perm_journal == "on" ? 1 : 0
                        }
                    }, {}, function (
            err,
            numReplaced,
            user
        ) {
            if ( err ) res.status( 500 ).send( err );
            else res.sendStatus( 200 );
        } );

    }

});


// ---- First-run setup ----------------------------------------------------
// A new installation has no user accounts. Instead of a built-in default
// login, the app shows a setup screen that creates the administrator
// (_id 1, full access). Setup is only possible while there are no users.

app.get( "/setup-status", function ( req, res ) {
    usersDB.count( {}, function ( err, count ) {
        if ( err ) return res.status( 500 ).send( err );
        res.send( { needsSetup: count === 0 } );
    } );
} );

app.post( "/setup", function ( req, res ) {
    let fullname = String( req.body.fullname || "" ).trim();
    let username = String( req.body.username || "" ).trim();
    let password = String( req.body.password || "" );

    if ( !fullname || fullname.length > 60 ) {
        return res.status( 400 ).send( "Please enter the administrator's full name." );
    }
    if ( !/^[A-Za-z0-9._-]{3,30}$/.test( username ) ) {
        return res.status( 400 ).send( "Username must be 3-30 characters: letters, numbers, dot, dash or underscore." );
    }
    if ( password.length < 6 || password.length > 100 ) {
        return res.status( 400 ).send( "Password must be at least 6 characters." );
    }

    usersDB.count( {}, function ( err, count ) {
        if ( err ) return res.status( 500 ).send( err );
        if ( count > 0 ) return res.status( 409 ).send( "Setup has already been completed. Please log in." );

        let User = {
            "_id": 1,
            "username": username,
            "password": btoa( password ),
            "fullname": fullname,
            "perm_products": 1,
            "perm_categories": 1,
            "perm_transactions": 1,
            "perm_returns": 1,
            "perm_users": 1,
            "perm_history": 1,
            "perm_settings": 1,
            "perm_profit": 1,
            "perm_expenses": 1,
            "perm_suppliers": 1,
            "perm_journal": 1,
            "status": ""
        };
        // the unique _id index stops a second, simultaneous setup
        usersDB.insert( User, function ( err ) {
            if ( err ) return res.status( 409 ).send( "Setup has already been completed. Please log in." );
            res.send( { _id: 1, username: username, fullname: fullname } );
        } );
    } );
} );


app.get( "/check", function ( req, res ) {
    usersDB.findOne( {
        _id: 1
}, function ( err, docs ) {
        // No administrator yet: nothing to do here - a new installation creates
        // it on the first-run setup screen (POST /setup), never as admin/admin.
        if(docs && (docs.perm_products != 1 || docs.perm_categories != 1 || docs.perm_transactions != 1 || docs.perm_returns != 1 || docs.perm_users != 1 || docs.perm_history != 1 || docs.perm_settings != 1 || docs.perm_profit != 1 || docs.perm_expenses != 1 || docs.perm_suppliers != 1 || docs.perm_journal != 1)) {
            // The bootstrap Administrator account (_id 1) must always have full access.
            // Its permissions can end up stripped if its profile is ever saved without
            // the permission checkboxes being populated (e.g. editing your own profile).
            usersDB.update( {
                _id: 1
            }, {
                $set: {
                    perm_products: 1,
                    perm_categories: 1,
                    perm_transactions: 1,
                    perm_returns: 1,
                    perm_users: 1,
                    perm_history: 1,
                    perm_settings: 1,
                    perm_profit: 1,
                    perm_expenses: 1,
                    perm_suppliers: 1,
                    perm_journal: 1
                }
            }, {}, function ( err, numReplaced ) {
            } );
        }
        res.sendStatus( 200 );
    } );
} );
