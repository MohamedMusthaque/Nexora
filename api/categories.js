const app = require( "express" )();
const server = require( "http" ).Server( app );
const bodyParser = require( "body-parser" );
const Datastore = require( "nedb" );
const async = require( "async" );


app.use( bodyParser.json() );

module.exports = app;

 
let categoryDB = new Datastore( {
    filename: process.env.APPDATA+"/POS/server/databases/categories.db",
    autoload: true
} );


categoryDB.ensureIndex({ fieldName: '_id', unique: true });
app.get( "/", function ( req, res ) {
    res.send( "Category API" );
} );


  
app.get( "/all", function ( req, res ) {
    categoryDB.find( {}, function ( err, docs ) {
        res.send( docs );
    } );
} );

 
app.post( "/category", function ( req, res ) {
    let newCategory = req.body;
    newCategory._id = Math.floor(Date.now() / 1000); 
    categoryDB.insert( newCategory, function ( err, category) {
        if ( err ) res.status( 500 ).send( err );
        else res.sendStatus( 200 );
    } );
} );



// only a category no product is in: deleting one in use would leave its
// products "Uncategorized" on the till (move them to another category first)
app.delete( "/category/:categoryId", function ( req, res ) {
    let id = parseInt( req.params.categoryId );
    require( "./inventory" ).getAllProducts( function ( err, products ) {
        if ( err ) return res.status( 500 ).send( "Could not check the category's products." );
        let used = ( products || [] ).filter( ( p ) => String( p.category ) === String( id ) ).length;
        if ( used ) {
            return res.status( 400 ).send( used + ( used === 1 ? " product is" : " products are" ) +
                " in this category. Move " + ( used === 1 ? "it" : "them" ) + " to another category (Edit product) before deleting it." );
        }
        categoryDB.remove( { _id: id }, function ( err ) {
            if ( err ) res.status( 500 ).send( "Could not delete the category." );
            else res.sendStatus( 200 );
        } );
    } );
} );

 

 
app.put( "/category", function ( req, res ) {
    categoryDB.update( {
        _id: parseInt(req.body.id)
    }, req.body, {}, function (
        err,
        numReplaced,
        category
    ) {
        if ( err ) res.status( 500 ).send( err );
        else res.sendStatus( 200 );
    } );
});



 