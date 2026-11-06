let app = require("express")();
let server = require("http").Server(app);
let bodyParser = require("body-parser");
let Datastore = require("nedb");
let Inventory = require("./inventory");

app.use(bodyParser.json());

module.exports = app;
 
let transactionsDB = new Datastore({
  filename: process.env.APPDATA+"/POS/server/databases/transactions.db",
  autoload: true
});


transactionsDB.ensureIndex({ fieldName: '_id', unique: true });

let returnsDB = new Datastore({
  filename: process.env.APPDATA+"/POS/server/databases/returns.db",
  autoload: true
});

returnsDB.ensureIndex({ fieldName: '_id', unique: true });

app.get("/", function(req, res) {
  res.send("Transactions API");
});

 
app.get("/all", function(req, res) {
  transactionsDB.find({}, function(err, docs) {
    res.send(docs);
  });
});



 
app.get("/on-hold", function(req, res) {
  transactionsDB.find(
    { $and: [{ ref_number: {$ne: ""}}, { status: 0  }]},    
    function(err, docs) {
      if (docs) res.send(docs);
    }
  );
});



app.get("/customer-orders", function(req, res) {
  transactionsDB.find(
    { $and: [{ customer: {$ne: "0"} }, { status: 0}, { ref_number: ""}]},
    function(err, docs) {
      if (docs) res.send(docs);
    }
  );
});



app.get("/by-date", function(req, res) {
  let startDate = new Date(req.query.start);
  let endDate = new Date(req.query.end);
  let status = parseInt(req.query.status);
  if (isNaN(status)) status = 1;
  let user = parseInt(req.query.user) || 0;
  let till = parseInt(req.query.till) || 0;

  let query = { $and: [{ date: { $gte: startDate.toJSON(), $lte: endDate.toJSON() }}] };

  // Paid = Cash / Card / Bank Transfer (and Mpesa) sales; Unpaid = Credit sales;
  // All (2) = Paid + Unpaid. Held orders (status 0, not Credit) are excluded from all.
  let paidQuery = { $and: [{ status: 1 }, { payment_type: { $in: ["Cash", "Card", "Bank Transfer", "Mpesa"] } }] };
  let unpaidQuery = { payment_type: "Credit" };

  if (status === 0) {
    query.$and.push(unpaidQuery);
  } else if (status === 2) {
    query.$and.push({ $or: [paidQuery, unpaidQuery] });
  } else {
    query.$and.push(paidQuery);
  }

  if (user !== 0) {
    query.$and.push({ user_id: user });
  }
  if (till !== 0) {
    query.$and.push({ till: till });
  }

  transactionsDB.find(query, function(err, docs) {
    if (err) {
      return res.status(500).send(err);
    }
    res.send(docs || []);
  });
});


// All completed (Cash / Card / Bank Transfer / Mpesa) and Credit transactions
// for one registered customer, newest first. Held orders are excluded.
app.get("/by-customer/:customerId", function(req, res) {
  let rawId = req.params.customerId;
  let numericId = parseInt(rawId);
  let ids = isNaN(numericId) ? [rawId] : [numericId, String(numericId)];

  let paidQuery = { $and: [{ status: 1 }, { payment_type: { $in: ["Cash", "Card", "Bank Transfer", "Mpesa"] } }] };
  let creditQuery = { payment_type: "Credit" };

  transactionsDB.find(
    { $and: [{ "customer.id": { $in: ids } }, { $or: [paidQuery, creditQuery] }] }
  ).sort({ date: -1 }).exec(function(err, docs) {
    if (err) return res.status(500).send(err);
    res.send(docs || []);
  });
});


app.post("/new", function(req, res) {
  let newTransaction = req.body;
  transactionsDB.insert(newTransaction, function(err, transaction) {    
    if (err) {
      return res.status(500).send(err);
    }

    // Handle transaction creation successfully
    res.status(200).send("Transaction created successfully.");

    // Call app.decrementInventory regardless of paid amount
    Inventory.decrementInventory(newTransaction.items, function(err, result) {
      if (err) {
        console.error("Error decrementing inventory:", err);
      } else {
        console.log("Inventory updated successfully.");
      }
    });
  });
});



app.put("/new", function(req, res) {
  let oderId = req.body._id;
  transactionsDB.update( {
      _id: oderId
  }, req.body, {}, function (
      err,
      numReplaced,
      order
  ) {
      if ( err ) res.status( 500 ).send( err );
      else res.sendStatus( 200 );
  } );
});


app.post( "/delete", function ( req, res ) {
 let transaction = req.body;
  transactionsDB.remove( {
      _id: transaction.orderId
  }, function ( err, numRemoved ) {
      if ( err ) res.status( 500 ).send( err );
      else res.sendStatus( 200 );
  } );
} );



app.get("/returns/order/:orderId", function(req, res) {
  returnsDB.find({ order_id: req.params.orderId }, function(err, docs) {
    if (err) return res.status(500).send(err);
    res.send(docs);
  });
});


app.post("/returns", function(req, res) {
  let body = req.body;
  let orderId = body.order_id;

  transactionsDB.findOne({ _id: orderId }, function(err, order) {
    if (err) return res.status(500).send(err);
    if (!order) return res.status(404).send("Original transaction not found.");

    returnsDB.find({ order_id: orderId }, function(err, existingReturns) {
      if (err) return res.status(500).send(err);

      let alreadyReturned = {};
      existingReturns.forEach(function(ret) {
        ret.items.forEach(function(item) {
          alreadyReturned[item.id] = (alreadyReturned[item.id] || 0) + parseInt(item.quantity);
        });
      });

      for (let i = 0; i < body.items.length; i++) {
        let requestedItem = body.items[i];
        let originalItem = order.items.find(function(item) { return item.id == requestedItem.id; });

        if (!originalItem) {
          return res.status(400).send("Item " + requestedItem.product_name + " was not part of the original order.");
        }

        let alreadyReturnedQty = alreadyReturned[requestedItem.id] || 0;
        let remaining = parseInt(originalItem.quantity) - alreadyReturnedQty;

        if (parseInt(requestedItem.quantity) <= 0 || parseInt(requestedItem.quantity) > remaining) {
          return res.status(400).send("Cannot return " + requestedItem.quantity + " of " + requestedItem.product_name + ". Only " + remaining + " remaining.");
        }
      }

      let refundAmount = body.items.reduce(function(sum, item) {
        return sum + (parseFloat(item.price) * parseInt(item.quantity));
      }, 0);

      let returnDoc = {
        _id: Date.now(),
        order_id: orderId,
        order_ref: order.ref_number || order.order,
        type: body.type === "exchange" ? "exchange" : "return",
        items: body.items,
        reason: body.reason || "",
        refund_amount: refundAmount,
        refund_method: body.refund_method || "",
        restocked: !!body.restock,
        till: body.till,
        mac: body.mac,
        user: body.user,
        user_id: body.user_id,
        date: new Date()
      };

      returnsDB.insert(returnDoc, function(err, inserted) {
        if (err) return res.status(500).send(err);

        function finish() {
          returnsDB.find({ order_id: orderId }, function(err, allReturns) {
            let returnedQty = {};
            allReturns.forEach(function(ret) {
              ret.items.forEach(function(item) {
                returnedQty[item.id] = (returnedQty[item.id] || 0) + parseInt(item.quantity);
              });
            });

            let fullyReturned = order.items.every(function(item) {
              return (returnedQty[item.id] || 0) >= parseInt(item.quantity);
            });
            let anyReturned = order.items.some(function(item) {
              return (returnedQty[item.id] || 0) > 0;
            });

            let returnStatus = fullyReturned ? "full" : (anyReturned ? "partial" : "none");

            transactionsDB.update(
              { _id: orderId },
              { $set: { return_status: returnStatus }, $inc: { returned_amount: refundAmount } },
              {},
              function(err) {
                if (err) return res.status(500).send(err);
                res.status(200).send({ return: inserted, refund_amount: refundAmount });
              }
            );
          });
        }

        if (body.restock) {
          Inventory.incrementInventory(body.items, function(err) {
            if (err) console.error("Error incrementing inventory:", err);
            finish();
          });
        } else {
          finish();
        }
      });
    });
  });
});


app.get("/:transactionId", function(req, res) {
  transactionsDB.find({ _id: req.params.transactionId }, function(err, doc) {
    if (doc) res.send(doc[0]);
  });
});
