const app = require("express")();
const server = require("http").Server(app);
const bodyParser = require("body-parser");
const Datastore = require("nedb");
const async = require("async");
const fileUpload = require("express-fileupload");
const multer = require("multer");
const fs = require("fs");

const storage = multer.diskStorage({
  destination: process.env.APPDATA + "/POS/uploads",
  filename: function (req, file, callback) {
    callback(null, Date.now() + ".jpg"); //
  },
});

let upload = multer({ storage: storage });

app.use(bodyParser.json());

module.exports = app;

let inventoryDB = new Datastore({
  filename: process.env.APPDATA + "/POS/server/databases/inventory.db",
  autoload: true,
});

inventoryDB.ensureIndex({ fieldName: "_id", unique: true });

// Log of product changes that aren't stored anywhere else: creation, edits
// (name/price/category/barcode/stock tracking), manual stock adjustments and
// deletion. Sales and returns come from the transactions/returns databases.
let historyDB = new Datastore({
  filename: process.env.APPDATA + "/POS/server/databases/product_history.db",
  autoload: true,
});

historyDB.ensureIndex({ fieldName: "product_id" });

function logHistory(entries) {
  if (!entries.length) return;
  historyDB.insert(entries, function (err) {
    if (err) console.error("Failed to write product history:", err);
  });
}

function historyEntry(product, type, extra, who) {
  return Object.assign(
    {
      product_id: parseInt(product._id),
      product_name: product.name,
      type: type,
      user: (who && who.user) || "",
      user_id: (who && who.user_id) || "",
      date: new Date(),
    },
    extra
  );
}

// Compares a product before/after an edit and builds the history entries
// ---- Product details (like other POS systems) ----
// brand: "Coca-Cola"; size: the size / variant ("500 ml", "Large", "Red") -
// products with the same name and different sizes share one till tile and the
// cashier picks the size; unit: what one item of stock is (piece, bottle,
// pack...); sku: the shop's own item code (also found by the scan box);
// reorder_level: the stock at which the till warns it is running low ("" = 5);
// description: notes. All optional; older products simply don't have them.
// the units the unit list starts with (Products > Units can add, rename and delete
// them); "" = piece (pcs), the default every product has unless it says otherwise
const DEFAULT_UNITS = ["pack", "packet", "box", "bottle", "can", "bag", "jar", "cup", "plate", "portion", "dozen", "pair", "set"];
const DEFAULT_REORDER_LEVEL = 5;

function cleanText(value, max) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

// a unit as stored: lowercase, short; "pcs" / "piece" is the default ("")
function cleanUnit(value) {
  let unit = cleanText(value, 20).toLowerCase();
  return ["pcs", "pc", "piece", "pieces"].includes(unit) ? "" : unit;
}

function productDetails(body, reorderText) {
  return {
    brand: cleanText(body.brand, 60),
    size: cleanText(body.size, 40),
    unit: cleanUnit(body.unit),
    sku: cleanText(body.sku, 40),
    description: String(body.description ?? "").trim().slice(0, 500),
    reorder_level: reorderText === "" ? "" : parseInt(reorderText),
  };
}

// the name shown on bills, GRNs, PRNs...: the name with its size ("Coca-Cola 500 ml"),
// unless the name already says it
function productDisplayName(p) {
  let name = String((p && p.name) || "");
  let size = String((p && p.size) || "").trim();
  if (!size || name.toLowerCase().includes(size.toLowerCase())) return name;
  return name + " " + size;
}

function editHistoryEntries(before, after, who) {
  let entries = [];
  let tracked = after.stock == 1;

  let oldQty = parseInt(before.quantity) || 0;
  let newQty = parseInt(after.quantity) || 0;
  if (tracked && oldQty !== newQty) {
    entries.push(
      historyEntry(after, "stock_adjustment", {
        qty_change: newQty - oldQty,
        qty_before: oldQty,
        qty_after: newQty,
      }, who)
    );
  }

  let changes = [];
  [
    ["name", "Name"],
    ["price", "Price"],
    ["cost_price", "Cost price"],
    ["category", "Category"],
    ["barcode", "Barcode"],
    ["brand", "Brand"],
    ["size", "Size"],
    ["unit", "Unit"],
    ["sku", "SKU"],
    ["reorder_level", "Low-stock alert"],
    ["description", "Description"],
  ].forEach(function (f) {
    if (String(before[f[0]] ?? "") !== String(after[f[0]] ?? "")) {
      changes.push({ field: f[0], label: f[1], from: before[f[0]], to: after[f[0]] });
    }
  });
  if ((before.stock == 1) !== tracked) {
    changes.push({
      field: "stock",
      label: "Stock tracking",
      from: before.stock == 1 ? "On" : "Off",
      to: tracked ? "On" : "Off",
    });
  }
  if (changes.length) {
    entries.push(historyEntry(after, "updated", { changes: changes }, who));
  }
  return entries;
}

app.getHistory = function (productId, callback) {
  let id = parseInt(productId);
  historyDB.find({ product_id: id }, callback);
};

app.get("/", function (req, res) {
  res.send("Inventory API");
});

app.get("/product/:productId", function (req, res) {
  if (!req.params.productId) {
    res.status(500).send("ID field is required.");
  } else {
    inventoryDB.findOne(
      {
        _id: parseInt(req.params.productId),
      },
      function (err, product) {
        attachBatches(product, function () {
          res.send(product);
        });
      }
    );
  }
});

app.get("/products", function (req, res) {
  inventoryDB.find({}, function (err, docs) {
    attachBatches(docs || [], function () {
      res.send(docs);
    });
  });
});

app.post("/product", upload.single("imagename"), function (req, res) {
  // Selling price (required) and cost price (optional, "" = not set yet) must
  // be plain positive numbers: digits with an optional decimal part, no signs,
  // letters or symbols. The form checks this too; this guards the database.
  // Checked first, before any image is removed; a rejected save also discards
  // the picture uploaded with it.
  const PRICE_PATTERN = /^(\d+(\.\d{1,2})?|\d*\.\d{1,2})$/;
  let priceText = String(req.body.price ?? "").trim();
  let costText = String(req.body.cost_price ?? "").trim();
  function reject(message) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).send(message);
  }
  if (!PRICE_PATTERN.test(priceText)) {
    return reject("Selling price must be a positive number (e.g. 150 or 150.50).");
  }
  if (costText !== "" && !PRICE_PATTERN.test(costText)) {
    return reject("Cost price must be a positive number (e.g. 120 or 120.50).");
  }

  let image = "";

  if (req.body.img != "") {
    image = req.body.img;
  }

  if (req.file) {
    image = req.file.filename;
  }

  if (req.body.remove == 1) {
    const path = "./resources/app/public/uploads/product_image/" + req.body.img;
    try {
      fs.unlinkSync(path);
    } catch (err) {
      console.error(err);
    }

    if (!req.file) {
      image = "";
    }
  }

  let reorderText = String(req.body.reorder_level ?? "").trim();
  if (reorderText !== "" && !/^\d{1,6}$/.test(reorderText)) {
    return reject("Low-stock alert must be a whole number (e.g. 5), or left empty.");
  }

  let Product = Object.assign(
    {
      _id: parseInt(req.body.id),
      price: priceText.startsWith(".") ? "0" + priceText : priceText, // ".75" -> "0.75"
      cost_price: costText === "" ? "" : parseFloat(costText).toFixed(2),
      category: req.body.category,
      quantity: req.body.quantity == "" ? 0 : req.body.quantity,
      name: req.body.name,
      stock: req.body.stock == "on" ? 0 : 1,
      barcode: req.body.barcode ? req.body.barcode : parseInt(req.body.id),
      img: image,
    },
    productDetails(req.body, reorderText)
  );

  let who = { user: req.body.history_user, user_id: req.body.history_user_id };

  if (req.body.id == "") {
    // Date.now() alone (or Date.now()/1000) can collide when products are
    // added in quick succession, which made nedb's unique _id index reject
    // the second insert and silently drop the new product while the UI
    // still reported success (the new barcode product ended up sharing the
    // stock/tile of the earlier one). Add a random suffix to keep IDs
    // unique even within the same millisecond.
    Product._id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    inventoryDB.insert(Product, function (err, product) {
      if (err) return res.status(500).send(err);
      logHistory([
        historyEntry(product, "created", {
          qty_change: product.stock == 1 ? parseInt(product.quantity) || 0 : 0,
          qty_before: 0,
          qty_after: product.stock == 1 ? parseInt(product.quantity) || 0 : null,
          price: product.price,
          cost_price: product.cost_price,
        }, who),
      ]);
      res.send(product);
    });
  } else {
    inventoryDB.findOne({ _id: parseInt(req.body.id) }, function (err, before) {
      inventoryDB.update(
        {
          _id: parseInt(req.body.id),
        },
        Product,
        {},
        function (err, numReplaced, product) {
          if (err) return res.status(500).send(err);
          if (before) logHistory(editHistoryEntries(before, Product, who));
          if (!before) return res.sendStatus(200);
          afterProductEdit(before, Product, who, function (err) {
            if (err) console.error("Batch update after product edit failed:", err);
            // the same item at its other cost prices gets the same details
            syncItemCopies(before, Product, who, function (err, copies) {
              if (err) console.error("Updating the item's other prices failed:", err);
              res.send({ copies_updated: copies || 0 });
            });
          });
        }
      );
    });
  }
});

app.delete("/product/:productId", function (req, res) {
  const img_path = process.env.APPDATA + "/POS/uploads/" + req.query.image_path;
  inventoryDB.findOne({ _id: parseInt(req.params.productId) }, function (err, product) {
    if (product) {
      logHistory([
        historyEntry(product, "deleted", {
          qty_before: product.stock == 1 ? parseInt(product.quantity) || 0 : null,
        }, { user: req.query.user, user_id: req.query.user_id }),
      ]);
    }
  });
  inventoryDB.remove(
    {
      _id: parseInt(req.params.productId),
    },
    function (err, numRemoved) {
      if (err) return res.status(500).send(err);
      batchesDB.remove({ product_id: parseInt(req.params.productId) }, { multi: true }, function (err) {
        if (err) console.error("Failed to remove the product's batches:", err);
      });
      fs.unlink(img_path, function (err) {
        if (err) {
          console.error(`Failed to delete image: ${img_path}`, err);
        }
        res.sendStatus(200);
      });
    }
  );
});

// A scanned code: a product's barcode, or the barcode of one of its selling
// prices (stock batches). The product comes back with its open batches and
// scanned_code = the price code scanned (when it belongs to a batch).
app.post("/product/sku", function (req, res) {
  var request = req.body;
  let code = String(request.skuCode ?? "").trim();
  let send = function (product) {
    attachBatches(product, function () {
      if (product && product.batches && product.batches.some((b) => b.barcode === code)) {
        product.scanned_code = code;
      }
      res.send(product);
    });
  };
  inventoryDB.findOne(
    {
      barcode: request.skuCode,
    },
    function (err, product) {
      if (product) return send(product);
      // a selling price's own barcode ("<product barcode>-2", ...)
      batchesDB.findOne({ barcode: code }, function (err, batch) {
        if (err || !batch) return findBySku();
        inventoryDB.findOne({ _id: batch.product_id }, function (err, owner) {
          if (err || !owner) return res.send(null);
          send(owner);
        });
      });
    }
  );
  // the shop's own item code (SKU), any case; several products can share it
  // (the same item at different costs): one with stock first
  function findBySku() {
    if (!code) return res.send(null);
    let pattern = new RegExp("^" + code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i");
    inventoryDB.find({ sku: pattern }, function (err, found) {
      if (err || !found || !found.length) return res.send(null);
      let inStock = found.find((p) => p.stock != 1 || (parseInt(p.quantity) || 0) > 0);
      send(inStock || found[0]);
    });
  }
});

// ======================================================================
// Stock batches: a selling price per GRN
// Each GRN line for a stock-tracked product becomes a batch with its own unit
// cost and selling price. The till charges the price of the code scanned (or
// the price picked); a sale without a code takes the oldest batch first. The
// product's price and cost price are those of the oldest batch with stock
// (the default price); when it runs out, the next batch's price takes over.
// Stock that was there before a product's first GRN becomes an "Opening
// stock" batch at the product's price at that time. Products that never had
// a GRN (and products that don't track stock) have no batches and work as
// before.
// Each selling price has its own barcode, printed on the goods, so the till
// knows which price to charge: the first price keeps the product's barcode,
// each new price gets "<product barcode>-2", "-3", ... Batches at the same
// selling price share their code.
// batch: { _id, product_id, seq (selling order), source: "opening" | "grn",
//          grn_id, reference, supplier, received_date, unit_cost (number or
//          null), selling_price, barcode, qty_received, qty_left, created_at }
// ======================================================================
let batchesDB = new Datastore({
  filename: process.env.APPDATA + "/POS/server/databases/batches.db",
  autoload: true,
  onload: function (err) {
    if (!err) assignMissingBatchCodes();
  },
});

batchesDB.ensureIndex({ fieldName: "product_id" });
batchesDB.ensureIndex({ fieldName: "barcode" });

// the product's own barcode (the code of its first selling price)
function productBaseCode(product) {
  let code = product.barcode == null ? "" : String(product.barcode).trim();
  return code && code !== "NaN" ? code : String(product._id);
}

// The barcode for a new batch: the code of a batch at the same selling price,
// else the product's barcode if no batch uses it yet, else the next free
// "<barcode>-N".
function batchCodeFor(product, batches, sellingPrice) {
  let base = productBaseCode(product);
  let same = batches.find((b) => b.barcode && money2(b.selling_price) === money2(sellingPrice));
  if (same) return same.barcode;
  let used = {};
  batches.forEach((b) => {
    if (b.barcode) used[b.barcode] = true;
  });
  if (!used[base]) return base;
  let n = 2;
  while (used[base + "-" + n]) n++;
  return base + "-" + n;
}

// batches saved before batches had barcodes get theirs (once, at start-up)
function assignMissingBatchCodes() {
  batchesDB.find({}, function (err, all) {
    if (err || !all.some((b) => !b.barcode)) return;
    let byProduct = {};
    all.forEach((b) => (byProduct[b.product_id] = byProduct[b.product_id] || []).push(b));
    Object.keys(byProduct).forEach(function (productId) {
      let list = byProduct[productId].sort((a, b) => a.seq - b.seq || a._id - b._id);
      if (!list.some((b) => !b.barcode)) return;
      inventoryDB.findOne({ _id: parseInt(productId) }, function (err, product) {
        if (err || !product) return;
        let done = [];
        list.forEach(function (b) {
          if (!b.barcode) {
            b.barcode = batchCodeFor(product, done, b.selling_price);
            batchesDB.update({ _id: b._id }, { $set: { barcode: b.barcode } }, {});
          }
          done.push(b);
        });
      });
    });
  });
}

// stock changes (sales, returns, GRNs, edits) run one at a time, so two of
// them can't take the same units from a batch
let stockQueue = Promise.resolve();
function inStockSeries(task) {
  stockQueue = stockQueue.then(
    () =>
      new Promise(function (resolve) {
        try {
          task(resolve);
        } catch (e) {
          console.error("Stock update failed:", e);
          resolve();
        }
      })
  );
}

let lastBatchId = 0;
function newBatchId() {
  lastBatchId = Math.max(Date.now(), lastBatchId + 1);
  return lastBatchId;
}

function money2(n) {
  return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
}

function numOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  let n = parseFloat(v);
  return isFinite(n) ? n : null;
}

// a product's batches in selling order (oldest first)
function productBatches(productId, callback) {
  batchesDB.find({ product_id: parseInt(productId) }, function (err, list) {
    if (err) return callback(err, []);
    callback(null, (list || []).sort((a, b) => a.seq - b.seq || a._id - b._id));
  });
}

function saveBatchQuantities(list, callback) {
  let seen = {};
  let unique = list.filter((b) => (seen[b._id] ? false : (seen[b._id] = true)));
  async.eachSeries(
    unique,
    function (b, next) {
      batchesDB.update({ _id: b._id }, { $set: { qty_left: b.qty_left } }, {}, next);
    },
    callback
  );
}

// Puts the price and cost price of the batch being sold now on the product
// (logged in the product history when they change). callback(err, product)
function applyCurrentBatchPrice(product, batches, who, callback) {
  let current = batches.find((b) => b.qty_left > 0);
  if (!current) return callback(null, product);
  let set = {};
  let price = money2(current.selling_price);
  if (parseFloat(product.price) !== parseFloat(price)) set.price = price;
  if (current.unit_cost !== null && current.unit_cost !== undefined) {
    let cost = money2(current.unit_cost);
    if (String(product.cost_price ?? "") !== cost) set.cost_price = cost;
  }
  if (!Object.keys(set).length) return callback(null, product);
  inventoryDB.update({ _id: product._id }, { $set: set }, {}, function (err) {
    if (err) return callback(err);
    let changes = [];
    if (set.price !== undefined) {
      changes.push({ field: "price", label: "Price (now selling " + current.reference + ")", from: product.price, to: set.price });
    }
    if (set.cost_price !== undefined) {
      changes.push({ field: "cost_price", label: "Cost price (" + current.reference + ")", from: product.cost_price, to: set.cost_price });
    }
    logHistory([historyEntry(product, "updated", { changes: changes, batch_id: current._id }, who)]);
    callback(null, Object.assign({}, product, set));
  });
}

// Makes a product's batches add up to its stock (a manual stock change in the
// product form adds to / takes from the batch being sold now), then puts the
// current batch's price on the product. Products without batches are left
// alone. Call inside inStockSeries. callback(err)
function reconcileProduct(productId, who, callback) {
  inventoryDB.findOne({ _id: parseInt(productId) }, function (err, product) {
    if (err || !product) return callback(err);
    if (product.stock != 1) return callback();
    productBatches(product._id, function (err, batches) {
      if (err || !batches.length) return callback(err);
      let stock = Math.max(parseInt(product.quantity) || 0, 0);
      let left = batches.reduce((s, b) => s + b.qty_left, 0);
      let changed = [];
      if (stock > left) {
        let target = batches.find((b) => b.qty_left > 0) || batches[batches.length - 1];
        target.qty_left += stock - left;
        changed.push(target);
      } else if (stock < left) {
        let remove = left - stock;
        batches.forEach((b) => {
          let take = Math.min(b.qty_left, remove);
          if (take > 0) {
            b.qty_left -= take;
            remove -= take;
            changed.push(b);
          }
        });
      }
      saveBatchQuantities(changed, function (err) {
        if (err) return callback(err);
        applyCurrentBatchPrice(product, batches, who, function (err) {
          callback(err);
        });
      });
    });
  });
}

// Open batches attached to products for the till: [{ _id, reference,
// qty_left, selling_price, unit_cost }] oldest first (only products that
// have batches get the field)
function attachBatches(products, callback) {
  let list = Array.isArray(products) ? products : products ? [products] : [];
  if (!list.length) return callback(null, products);
  let ids = list.map((p) => parseInt(p._id));
  batchesDB.find({ product_id: { $in: ids }, qty_left: { $gt: 0 } }, function (err, batches) {
    if (err) return callback(null, products); // the till still works without them
    let byProduct = {};
    (batches || [])
      .sort((a, b) => a.seq - b.seq || a._id - b._id)
      .forEach((b) => {
        (byProduct[b.product_id] = byProduct[b.product_id] || []).push({
          _id: b._id,
          reference: b.reference,
          barcode: b.barcode || "",
          qty_left: b.qty_left,
          selling_price: money2(b.selling_price),
          unit_cost: b.unit_cost,
        });
      });
    list.forEach((p) => {
      if (p.stock == 1 && byProduct[p._id]) p.batches = byProduct[p._id];
    });
    callback(null, products);
  });
}
app.attachBatches = attachBatches;

// all of a product's batches, oldest first (product history)
app.get("/batches/:productId", function (req, res) {
  productBatches(req.params.productId, function (err, batches) {
    if (err) return res.status(500).send("Could not load the batches.");
    res.send(batches);
  });
});

// A sale takes stock from batches: the batches of the line's price code first
// (the barcode scanned / price picked, items[].batch_code), then its own
// batch (items[].batch_id), then the oldest batches.
// callback(err, allocations) - allocations[i] for items[i]:
//   [{ batch_id, reference, qty, unit_cost, selling_price }] (empty for
//   products without batches)
app.decrementInventory = function (products, callback) {
  let allocations = [];
  let touched = {};
  inStockSeries(function (done) {
    let finish = function (err) {
      done();
      if (err) callback(err);
      else callback(null, allocations);
    };
    async.eachOfSeries(
      products || [],
      function (line, index, next) {
        allocations[index] = [];
        inventoryDB.findOne({ _id: parseInt(line.id) }, function (err, product) {
          if (err) return next(err);
          if (!product || !product.quantity) return next();
          let qty = parseInt(line.quantity) || 0;
          let updatedQuantity = parseInt(product.quantity) - qty;
          productBatches(product._id, function (err, batches) {
            if (err) return next(err);
            let changed = [];
            if (product.stock == 1 && batches.length && qty > 0) {
              let remaining = qty;
              let take = function (b) {
                let n = Math.min(b.qty_left, remaining);
                if (n <= 0) return;
                b.qty_left -= n;
                remaining -= n;
                changed.push(b);
                let a = allocations[index].find((x) => x.batch_id === b._id);
                if (a) a.qty += n;
                else {
                  allocations[index].push({
                    batch_id: b._id,
                    reference: b.reference,
                    barcode: b.barcode || "",
                    qty: n,
                    unit_cost: b.unit_cost,
                    selling_price: b.selling_price,
                  });
                }
              };
              // the price the line was rung up at: its barcode's batches first
              if (line.batch_code) {
                batches.forEach((b) => {
                  if (remaining > 0 && b.barcode === String(line.batch_code)) take(b);
                });
              }
              let own = line.batch_id != null ? batches.find((b) => String(b._id) === String(line.batch_id)) : null;
              if (own) take(own);
              batches.forEach((b) => {
                if (remaining > 0) take(b);
              });
              touched[product._id] = true;
            }
            saveBatchQuantities(changed, function (err) {
              if (err) return next(err);
              inventoryDB.update({ _id: product._id }, { $set: { quantity: updatedQuantity } }, {}, next);
            });
          });
        });
      },
      function (err) {
        if (err) return finish(err);
        // the next batch's price takes over where a batch ran out
        async.eachSeries(
          Object.keys(touched),
          function (id, next) {
            reconcileProduct(id, { user: "", user_id: "" }, function (err) {
              if (err) console.error("Batch price update failed:", err);
              next();
            });
          },
          finish
        );
      }
    );
  });
};

// ---- Goods received: one product per cost price ----
// A GRN line goes to the product (same name and category) that already has
// the line's unit cost as its cost price: its stock goes up. When no such
// product exists, suppliers.js first creates one (createGrnProduct): the same
// name, category, picture and stock tracking, the line's unit cost as its cost
// price and its own selling price and barcode. The till shows products with
// the same name on one tile and asks which price to ring up.

// A new, unique 12-digit barcode (same format as the product form's)
function newProductBarcode(callback) {
  let make = function () {
    let digits = [];
    for (let i = 0; i < 11; i++) digits.push(Math.floor(Math.random() * 10));
    let odd = 0, even = 0;
    digits.forEach((d, i) => (i % 2 === 0 ? (odd += d) : (even += d)));
    let check = (odd * 3 + even) % 10;
    digits.push(check ? 10 - check : 0);
    return digits.join("");
  };
  let attempt = function (left) {
    let code = make();
    inventoryDB.findOne({ barcode: code }, function (err, taken) {
      if (err) return callback(err);
      if (taken && left > 0) return attempt(left - 1);
      callback(null, code);
    });
  };
  attempt(20);
}

let lastProductId = 0;
function newProductId() {
  // same form as the product form's ids (milliseconds x 1000 + random part)
  let id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  lastProductId = Math.max(id, lastProductId + 1);
  return lastProductId;
}

// Creates the product for goods received at a new cost: a copy of `source`
// (name, category, picture, stock tracking) with no stock yet, the given cost
// and selling price, and the barcode typed / scanned in the GRN form
// (info.barcode) or a new one. callback(err, product)
app.createGrnProduct = function (source, costPrice, sellingPrice, info, callback) {
  let withBarcode = info.barcode
    ? (cb) => cb(null, String(info.barcode))
    : newProductBarcode;
  withBarcode(function (err, barcode) {
    if (err) return callback(err);
    let product = {
      _id: newProductId(),
      price: money2(sellingPrice),
      cost_price: money2(costPrice),
      category: source.category,
      quantity: 0,
      name: source.name,
      stock: source.stock == 1 ? 1 : 0,
      barcode: barcode,
      img: source.img || "",
      // the same item at another cost: same brand, size, unit, code and alert level
      brand: source.brand || "",
      size: source.size || "",
      unit: source.unit || "",
      sku: source.sku || "",
      description: source.description || "",
      reorder_level: source.reorder_level ?? "",
    };
    inventoryDB.insert(product, function (err, saved) {
      if (err) return callback(err);
      logHistory([
        historyEntry(saved, "created", {
          qty_change: 0,
          qty_before: 0,
          qty_after: saved.stock == 1 ? 0 : null,
          price: saved.price,
          cost_price: saved.cost_price,
          reference: info.reference || "",
          note: "Created by " + (info.reference || "a GRN") + ": goods received at a new cost price",
        }, { user: info.user, user_id: info.user_id }),
      ]);
      callback(null, saved);
    });
  });
};

// "Coca-Cola 500 ml": for GRN / PRN / stock adjustment lines (suppliers.js, adjustments.js)
app.productDisplayName = productDisplayName;

// a quantity with its unit: "3 packets", "1 bottle"; no unit: "" (journal.js)
const UNIT_PLURALS = { box: "boxes", dozen: "dozen" };
function productUnitText(unit, qty) {
  unit = String(unit || "");
  if (!unit) return "";
  let n = parseInt(qty) || 0;
  if (n === 1) return unit;
  if (UNIT_PLURALS[unit]) return UNIT_PLURALS[unit];
  if (/^(kg|g|mg|l|ml|m|cm|mm|lb|oz)$/.test(unit) || /s$/.test(unit)) return unit;
  if (/(x|z|ch|sh)$/.test(unit)) return unit + "es";
  if (/[^aeiou]y$/.test(unit)) return unit.slice(0, -1) + "ies";
  return unit + "s";
}
app.productUnitText = productUnitText;

// ---- Brands (Products window > Brands tab, and the product form's Brand list) ----
// The brand list: brands added in the Brands tab or with "+ New" in the product
// form (like expense types), so a brand can exist before any product has it.
// A product keeps its brand's name (product.brand); brands already used on
// products before this list existed still show (the client adds them).
// Brands are the same whatever the case / spacing ("Nestle" = "NESTLE ").
let brandsDB = new Datastore({
  filename: process.env.APPDATA + "/POS/server/databases/brands.db",
  autoload: true,
});
brandsDB.ensureIndex({ fieldName: "_id", unique: true });

function brandKeyOf(name) {
  return cleanText(name, 60).toLowerCase();
}

// the brands, with how many products have each (a brand in use can't be deleted)
app.get("/brands", function (req, res) {
  brandsDB.find({}).sort({ name: 1 }).exec(function (err, brands) {
    if (err) return res.status(500).send("Could not load the brands.");
    inventoryDB.find({}, { brand: 1 }, function (err, products) {
      if (err) return res.status(500).send("Could not load the brands.");
      let counts = {};
      products.forEach((p) => {
        let k = brandKeyOf(p.brand);
        if (k) counts[k] = (counts[k] || 0) + 1;
      });
      res.send(brands.map((b) => Object.assign({}, b, { product_count: counts[brandKeyOf(b.name)] || 0 })));
    });
  });
});

// Body: { name } -> the new brand
app.post("/brands", function (req, res) {
  let name = cleanText(req.body.name, 60);
  if (!name) return res.status(400).send("Please enter the brand name.");
  brandsDB.find({}, function (err, brands) {
    if (err) return res.status(500).send("Could not save the brand.");
    let existing = brands.find((b) => brandKeyOf(b.name) === brandKeyOf(name));
    if (existing) return res.status(409).send('A brand called "' + existing.name + '" already exists.');
    let brand = { _id: Date.now() * 1000 + Math.floor(Math.random() * 1000), name: name, created_at: new Date().toJSON() };
    brandsDB.insert(brand, function (err, saved) {
      if (err) return res.status(500).send("Could not save the brand.");
      res.send(saved);
    });
  });
});

// only a brand no product has (otherwise: rename / merge it instead)
app.delete("/brands/:id", function (req, res) {
  let id = parseInt(req.params.id);
  brandsDB.findOne({ _id: id }, function (err, brand) {
    if (err) return res.status(500).send("Could not delete the brand.");
    if (!brand) return res.status(404).send("That brand no longer exists.");
    inventoryDB.find({}, { brand: 1 }, function (err, products) {
      if (err) return res.status(500).send("Could not delete the brand.");
      let used = products.filter((p) => brandKeyOf(p.brand) === brandKeyOf(brand.name)).length;
      if (used) {
        return res.status(400).send(used + (used === 1 ? " product has" : " products have") + ' the brand "' + brand.name +
          '". Change their brand (or merge it into another brand with Rename) before deleting it.');
      }
      brandsDB.remove({ _id: id }, {}, function (err) {
        if (err) return res.status(500).send("Could not delete the brand.");
        res.sendStatus(200);
      });
    });
  });
});

// The brand list after a rename: the old name's entry goes (unless only the
// case / spacing changed), and the new name is in the list once, spelled `to`.
function renameBrandInList(from, to, callback) {
  brandsDB.find({}, function (err, brands) {
    if (err) return callback(err);
    let stale = brands.filter((b) => brandKeyOf(b.name) === brandKeyOf(from) && brandKeyOf(from) !== brandKeyOf(to));
    let target = brands.find((b) => brandKeyOf(b.name) === brandKeyOf(to));
    brandsDB.remove({ _id: { $in: stale.map((b) => b._id) } }, { multi: true }, function (err) {
      if (err) return callback(err);
      if (target) return brandsDB.update({ _id: target._id }, { $set: { name: to } }, {}, (err) => callback(err));
      brandsDB.insert({ _id: Date.now() * 1000 + Math.floor(Math.random() * 1000), name: to, created_at: new Date().toJSON() }, (err) => callback(err));
    });
  });
}

// Renames a brand on every product that has it (any case / spacing), e.g. to
// fix the spelling, or to merge "Nestle" into "Nestlé" - and in the brand
// list. Each product's history records the change.
// Body: { from, to, user, user_id } -> { updated }
app.post("/brands/rename", function (req, res) {
  let from = cleanText(req.body.from, 60);
  let to = cleanText(req.body.to, 60);
  if (!from) return res.status(400).send("Choose the brand to rename.");
  if (!to) return res.status(400).send("Enter the new brand name.");
  let same = (b) => cleanText(b, 60).toLowerCase() === from.toLowerCase();
  inventoryDB.find({}, function (err, products) {
    if (err) return res.status(500).send("Could not load the products.");
    let hits = products.filter((p) => same(p.brand) && String(p.brand) !== to);
    let finish = function (updated) {
      renameBrandInList(from, to, function (err) {
        if (err) return res.status(500).send("The products were renamed, but the brand list could not be updated.");
        res.send({ updated: updated });
      });
    };
    if (!hits.length) return finish(0);
    let who = { user: req.body.user, user_id: req.body.user_id };
    let done = 0;
    let failed = false;
    hits.forEach(function (p) {
      inventoryDB.update({ _id: p._id }, { $set: { brand: to } }, {}, function (err) {
        if (failed) return;
        if (err) {
          failed = true;
          return res.status(500).send("Could not rename the brand on every product. Please try again.");
        }
        logHistory([historyEntry(Object.assign({}, p, { brand: to }), "updated", {
          changes: [{ field: "brand", label: "Brand", from: p.brand, to: to }],
        }, who)]);
        if (++done === hits.length) finish(done);
      });
    });
  });
});

// ---- Units (Products window > Units tab, and the product form's Unit list) ----
// What one item of stock is: packet, bottle, box... (piece is the default).
// The list starts with DEFAULT_UNITS the first time (a unit deleted later
// stays deleted), and Products > Units adds, renames / merges and deletes.
const unitsFile = process.env.APPDATA + "/POS/server/databases/units.db";
const unitsAreNew = !fs.existsSync(unitsFile);
let unitsDB = new Datastore({
  filename: unitsFile,
  autoload: true,
  onload: function (err) {
    if (err || !unitsAreNew) return;
    let base = Date.now() * 1000;
    unitsDB.insert(DEFAULT_UNITS.map((name, i) => ({ _id: base + i, name: name, created_at: new Date().toJSON() })), function () {});
  },
});

function newUnitId() {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

// the units, with how many products have each (a unit in use can't be deleted)
app.get("/units", function (req, res) {
  unitsDB.find({}).sort({ name: 1 }).exec(function (err, units) {
    if (err) return res.status(500).send("Could not load the units.");
    inventoryDB.find({}, { unit: 1 }, function (err, products) {
      if (err) return res.status(500).send("Could not load the units.");
      let counts = {};
      products.forEach((p) => {
        let u = cleanUnit(p.unit);
        if (u) counts[u] = (counts[u] || 0) + 1;
      });
      res.send(units.map((u) => Object.assign({}, u, { product_count: counts[cleanUnit(u.name)] || 0 })));
    });
  });
});

// Body: { name } -> the new unit (lowercase: "Packet" -> "packet")
app.post("/units", function (req, res) {
  let raw = cleanText(req.body.name, 20);
  if (!raw) return res.status(400).send("Please enter the unit, e.g. packet.");
  let name = cleanUnit(raw);
  if (!name) return res.status(409).send("Piece (pcs) is already the default unit.");
  unitsDB.find({}, function (err, units) {
    if (err) return res.status(500).send("Could not save the unit.");
    let existing = units.find((u) => cleanUnit(u.name) === name);
    if (existing) return res.status(409).send('The unit "' + existing.name + '" already exists.');
    unitsDB.insert({ _id: newUnitId(), name: name, created_at: new Date().toJSON() }, function (err, saved) {
      if (err) return res.status(500).send("Could not save the unit.");
      res.send(saved);
    });
  });
});

// only a unit no product has
app.delete("/units/:id", function (req, res) {
  let id = parseInt(req.params.id);
  unitsDB.findOne({ _id: id }, function (err, unit) {
    if (err) return res.status(500).send("Could not delete the unit.");
    if (!unit) return res.status(404).send("That unit no longer exists.");
    inventoryDB.find({}, { unit: 1 }, function (err, products) {
      if (err) return res.status(500).send("Could not delete the unit.");
      let used = products.filter((p) => cleanUnit(p.unit) === cleanUnit(unit.name)).length;
      if (used) {
        return res.status(400).send(used + (used === 1 ? " product is" : " products are") + ' sold by the "' + unit.name +
          '". Change their unit (or merge it into another unit with Rename) before deleting it.');
      }
      unitsDB.remove({ _id: id }, {}, function (err) {
        if (err) return res.status(500).send("Could not delete the unit.");
        res.sendStatus(200);
      });
    });
  });
});

// Renames a unit on every product that has it, and in the unit list; renaming
// to an existing unit merges the two. Each product's history records it.
// Body: { from, to, user, user_id } -> { updated }
app.post("/units/rename", function (req, res) {
  let from = cleanUnit(req.body.from);
  let to = cleanUnit(req.body.to);
  if (!from) return res.status(400).send("Choose the unit to rename.");
  if (!cleanText(req.body.to, 20)) return res.status(400).send("Enter the new unit.");
  if (!to) return res.status(400).send("Piece (pcs) is the default unit: choose another name.");
  inventoryDB.find({}, function (err, products) {
    if (err) return res.status(500).send("Could not load the products.");
    let hits = from === to ? [] : products.filter((p) => cleanUnit(p.unit) === from);
    let finish = function (updated) {
      unitsDB.find({}, function (err, units) {
        if (err) return res.status(500).send("The products were changed, but the unit list could not be updated.");
        let stale = from === to ? [] : units.filter((u) => cleanUnit(u.name) === from);
        let target = units.find((u) => cleanUnit(u.name) === to);
        unitsDB.remove({ _id: { $in: stale.map((u) => u._id) } }, { multi: true }, function () {
          let done = () => res.send({ updated: updated });
          if (target) return done();
          unitsDB.insert({ _id: newUnitId(), name: to, created_at: new Date().toJSON() }, done);
        });
      });
    };
    if (!hits.length) return finish(0);
    let who = { user: req.body.user, user_id: req.body.user_id };
    let done = 0;
    let failed = false;
    hits.forEach(function (p) {
      inventoryDB.update({ _id: p._id }, { $set: { unit: to } }, {}, function (err) {
        if (failed) return;
        if (err) {
          failed = true;
          return res.status(500).send("Could not change the unit on every product. Please try again.");
        }
        logHistory([historyEntry(Object.assign({}, p, { unit: to }), "updated", {
          changes: [{ field: "unit", label: "Unit", from: p.unit, to: to }],
        }, who)]);
        if (++done === hits.length) finish(done);
      });
    });
  });
});

// the products with these ids (missing ones are simply not in the result)
app.getProductsByIds = function (ids, callback) {
  inventoryDB.find({ _id: { $in: ids.map((id) => parseInt(id)) } }, callback);
};

// all products (suppliers.js looks for one with the same name and cost)
app.getAllProducts = function (callback) {
  inventoryDB.find({}, callback);
};

// Adds each received line to its product's stock (the product with that
// cost price, see above). A product without a cost price yet takes the
// line's unit cost. Every line is logged in the product history as a "grn"
// event with what was paid per unit.
// items: [{ product_id, quantity, unit_cost }]
// info: { grn_id, reference, supplier, payment_method, received_date,
//         user, user_id }
app.receiveGoods = function (items, info, callback) {
  let who = { user: info.user, user_id: info.user_id };
  let touched = {};
  inStockSeries(function (done) {
    async.eachSeries(
      items,
      function (item, next) {
        inventoryDB.findOne({ _id: parseInt(item.product_id) }, function (err, product) {
          if (err) return next(err);
          if (!product) return next(); // deleted meanwhile: nothing to add stock to

          let qtyBefore = parseInt(product.quantity) || 0;
          let qtyAfter = qtyBefore + item.quantity;
          let set = { quantity: qtyAfter };
          let noCost = product.cost_price === undefined || product.cost_price === null || product.cost_price === "";
          if (noCost) set.cost_price = money2(item.unit_cost);

          inventoryDB.update({ _id: product._id }, { $set: set }, {}, function (err) {
            if (err) return next(err);
            let extra = {
              qty_change: item.quantity,
              qty_before: qtyBefore,
              qty_after: qtyAfter,
              price: item.unit_cost, // what was paid per unit on this GRN
              selling_price: money2(product.price),
              amount: Math.round(item.quantity * item.unit_cost * 100) / 100,
              reference: info.reference,
              grn_id: info.grn_id,
              supplier: info.supplier,
              payment_method: info.payment_method,
              received_date: info.received_date,
              new_product: !!item.new_product,
            };
            if (noCost) {
              extra.cost_before = product.cost_price ?? "";
              extra.cost_after = set.cost_price;
            }
            logHistory([historyEntry(product, "grn", extra, who)]);
            // products that still have stock batches from before: the new
            // units join the batch being sold now
            if (product.stock == 1) touched[product._id] = true;
            next();
          });
        });
      },
      function (err) {
        if (err) {
          done();
          return callback(err);
        }
        async.eachSeries(
          Object.keys(touched),
          function (id, next) {
            reconcileProduct(id, who, function (err) {
              if (err) console.error("Batch update after GRN failed:", err);
              next();
            });
          },
          function () {
            done();
            callback(null);
          }
        );
      }
    );
  });
};

// ---- Purchase returns (PRN, see suppliers.js): goods sent back to a supplier ----
// Each line comes out of its product's stock and is logged in the product
// history as a "prn" event. items: [{ product_id, quantity, unit_cost }]
// info: { prn_id, reference, supplier, refund_method, return_date, user, user_id }
app.returnGoods = function (items, info, callback) {
  let who = { user: info.user, user_id: info.user_id };
  let touched = {};
  inStockSeries(function (done) {
    async.eachSeries(
      items,
      function (item, next) {
        inventoryDB.findOne({ _id: parseInt(item.product_id) }, function (err, product) {
          if (err) return next(err);
          if (!product) return next();
          let qtyBefore = parseInt(product.quantity) || 0;
          let qtyAfter = qtyBefore - item.quantity;
          inventoryDB.update({ _id: product._id }, { $set: { quantity: qtyAfter } }, {}, function (err) {
            if (err) return next(err);
            logHistory([
              historyEntry(product, "prn", {
                qty_change: -item.quantity,
                qty_before: qtyBefore,
                qty_after: qtyAfter,
                price: item.unit_cost, // the cost per unit sent back
                amount: Math.round(item.quantity * item.unit_cost * 100) / 100,
                reference: info.reference,
                prn_id: info.prn_id,
                supplier: info.supplier,
                refund_method: info.refund_method,
                return_date: info.return_date,
              }, who),
            ]);
            // products that still have stock batches from before
            if (product.stock == 1) touched[product._id] = true;
            next();
          });
        });
      },
      function (err) {
        if (err) {
          done();
          return callback(err);
        }
        async.eachSeries(
          Object.keys(touched),
          function (id, next) {
            reconcileProduct(id, who, function (err) {
              if (err) console.error("Batch update after PRN failed:", err);
              next();
            });
          },
          function () {
            done();
            callback(null);
          }
        );
      }
    );
  });
};

// ---- Stock adjustments (see adjustments.js): stock lost, expired, damaged,
// used in the shop, or found in a stock count ----
// A line taking stock out comes out of the batch picked (items[].batch_id,
// e.g. the delivery that expired) first, then the oldest batches. A line
// adding stock goes into the batch picked, else the batch being sold now.
// Each line is valued at the cost of the units it moved (the batch's unit
// cost, else the product's cost price) and logged in the product history as
// an "adjustment" event.
// items: [{ product_id, quantity, batch_id? }]
// info: { direction: "out" | "in", adjustment_id, reference, reason, date,
//         user, user_id }
// callback(err, results) - results[i] for items[i]:
//   { qty_before, qty_after, unit_cost, value, no_cost, batches: [{ batch_id, reference, qty, unit_cost }] }
app.adjustStock = function (items, info, callback) {
  let who = { user: info.user, user_id: info.user_id };
  let out = info.direction === "out";
  let results = [];
  let touched = {};
  inStockSeries(function (done) {
    async.eachOfSeries(
      items,
      function (item, index, next) {
        results[index] = null;
        inventoryDB.findOne({ _id: parseInt(item.product_id) }, function (err, product) {
          if (err) return next(err);
          if (!product) return next(); // deleted meanwhile
          let qty = parseInt(item.quantity) || 0;
          let qtyBefore = parseInt(product.quantity) || 0;
          let qtyAfter = out ? qtyBefore - qty : qtyBefore + qty;
          let productCost = numOrNull(product.cost_price);
          productBatches(product._id, function (err, batches) {
            if (err) return next(err);
            let changed = [];
            let moved = []; // [{ batch_id, reference, qty, unit_cost }]
            let picked = item.batch_id != null ? batches.find((b) => String(b._id) === String(item.batch_id)) : null;
            let costOf = (b) => (b && b.unit_cost !== null && b.unit_cost !== undefined ? Number(b.unit_cost) : productCost);
            if (product.stock == 1 && batches.length) {
              if (out) {
                let remaining = qty;
                let take = function (b) {
                  let n = Math.min(b.qty_left, remaining);
                  if (n <= 0) return;
                  b.qty_left -= n;
                  remaining -= n;
                  changed.push(b);
                  let m = moved.find((x) => x.batch_id === b._id);
                  if (m) m.qty += n;
                  else moved.push({ batch_id: b._id, reference: b.reference, qty: n, unit_cost: costOf(b) });
                };
                if (picked) take(picked);
                batches.forEach((b) => {
                  if (remaining > 0) take(b);
                });
              } else {
                // into the batch picked, else the batch being sold now
                let target = picked || batches.find((b) => b.qty_left > 0) || batches[batches.length - 1];
                target.qty_left += qty;
                changed.push(target);
                moved.push({ batch_id: target._id, reference: target.reference, qty: qty, unit_cost: costOf(target) });
              }
              touched[product._id] = true;
            }
            // value: the units' batch costs; units outside any batch at the product's cost price
            let inBatches = moved.reduce((s, m) => s + m.qty, 0);
            let noCost = moved.some((m) => m.unit_cost === null) || (qty > inBatches && productCost === null);
            let value = moved.reduce((s, m) => s + m.qty * (m.unit_cost || 0), 0) + Math.max(qty - inBatches, 0) * (productCost || 0);
            value = Math.round(value * 100) / 100;
            let unitCost = qty ? Math.round((value / qty) * 100) / 100 : 0;
            saveBatchQuantities(changed, function (err) {
              if (err) return next(err);
              inventoryDB.update({ _id: product._id }, { $set: { quantity: qtyAfter } }, {}, function (err) {
                if (err) return next(err);
                results[index] = {
                  qty_before: qtyBefore,
                  qty_after: qtyAfter,
                  unit_cost: unitCost,
                  value: value,
                  no_cost: noCost,
                  batches: moved,
                };
                logHistory([
                  historyEntry(product, "adjustment", {
                    qty_change: out ? -qty : qty,
                    qty_before: qtyBefore,
                    qty_after: qtyAfter,
                    price: unitCost, // the cost per unit
                    amount: value,
                    no_cost: noCost,
                    direction: info.direction,
                    reason: info.reason,
                    reference: info.reference,
                    adjustment_id: info.adjustment_id,
                    adjustment_date: info.date,
                    batches: moved.map((m) => ({ batch_id: m.batch_id, reference: m.reference, qty: m.qty })),
                  }, who),
                ]);
                next();
              });
            });
          });
        });
      },
      function (err) {
        if (err) {
          done();
          return callback(err, results);
        }
        // a batch emptied (or refilled): the right price takes over
        async.eachSeries(
          Object.keys(touched),
          function (id, next) {
            reconcileProduct(id, who, function (err) {
              if (err) console.error("Batch update after stock adjustment failed:", err);
              next();
            });
          },
          function () {
            done();
            callback(null, results);
          }
        );
      }
    );
  });
};

// A return puts stock back: into the batches the sold units came from
// (items[].batches, from the sale) where known, otherwise into the batch
// being sold now. items: [{ id, quantity, batches? }]
app.incrementInventory = function (products, callback) {
  let touched = {};
  inStockSeries(function (done) {
    async.eachSeries(
      products || [],
      function (line, next) {
        inventoryDB.findOne({ _id: parseInt(line.id) }, function (err, product) {
          if (err) return next(err);
          if (!product) return next();
          let qty = parseInt(line.quantity) || 0;
          let updatedQuantity = parseInt(product.quantity || 0) + qty;
          productBatches(product._id, function (err, batches) {
            if (err) return next(err);
            let changed = [];
            if (product.stock == 1 && batches.length && Array.isArray(line.batches)) {
              let remaining = qty;
              // the units sold last come back first
              line.batches
                .slice()
                .reverse()
                .forEach((a) => {
                  let b = batches.find((x) => String(x._id) === String(a.batch_id));
                  let n = Math.min(parseInt(a.qty) || 0, remaining);
                  if (b && n > 0) {
                    b.qty_left += n;
                    remaining -= n;
                    changed.push(b);
                  }
                });
              // the rest is placed by reconcileProduct (the batch being sold now)
            }
            if (product.stock == 1 && batches.length) touched[product._id] = true;
            saveBatchQuantities(changed, function (err) {
              if (err) return next(err);
              inventoryDB.update({ _id: product._id }, { $set: { quantity: updatedQuantity } }, {}, next);
            });
          });
        });
      },
      function (err) {
        if (err) {
          done();
          return callback(err);
        }
        async.eachSeries(
          Object.keys(touched),
          function (id, next) {
            reconcileProduct(id, { user: "", user_id: "" }, function (err) {
              if (err) console.error("Batch price update failed:", err);
              next();
            });
          },
          function () {
            done();
            callback(null, "Inventory updated successfully.");
          }
        );
      }
    );
  });
};

// After the product form is saved: a new price / cost price applies to the
// batch being sold now, and a stock change adds to / takes from it.
// ---- one item, several products (one per cost price) ----
// Goods received at a new cost become a product of their own (createGrnProduct):
// the same item - same name, brand, size and category - with its own cost,
// price, barcode and stock. What describes the item is shared, so editing
// one of them changes the others too; each keeps its own price, cost,
// barcode and stock. Their history records the change.
const ITEM_SHARED_FIELDS = ["name", "brand", "size", "unit", "sku", "category", "description", "reorder_level", "img", "stock"];

function itemFamilyKey(p) {
  return [p.name, p.brand, p.size].map((t) => String(t || "").replace(/\s+/g, " ").trim().toLowerCase()).join("||") +
    "||" + String(p.category ?? "");
}

function syncItemCopies(before, after, who, callback) {
  let changed = ITEM_SHARED_FIELDS.filter((f) => String(before[f] ?? "") !== String(after[f] ?? ""));
  if (!changed.length) return callback(null, 0);
  inventoryDB.find({}, function (err, all) {
    if (err) return callback(err, 0);
    let copies = all.filter((p) => p._id !== after._id && itemFamilyKey(p) === itemFamilyKey(before));
    if (!copies.length) return callback(null, 0);
    let set = {};
    changed.forEach((f) => (set[f] = after[f]));
    async.eachSeries(
      copies,
      function (p, next) {
        inventoryDB.update({ _id: p._id }, { $set: set }, {}, function (err) {
          if (err) return next(err);
          logHistory(editHistoryEntries(p, Object.assign({}, p, set), who));
          next();
        });
      },
      (err) => callback(err, copies.length)
    );
  });
}

function afterProductEdit(before, after, who, callback) {
  inStockSeries(function (done) {
    let finish = function (err) {
      done();
      callback(err);
    };
    if (after.stock != 1) return finish();
    productBatches(after._id, function (err, batches) {
      if (err || !batches.length) return finish(err);
      let current = batches.find((b) => b.qty_left > 0);
      let set = {};
      if (current && parseFloat(before.price) !== parseFloat(after.price)) set.selling_price = money2(after.price);
      if (current && String(before.cost_price ?? "") !== String(after.cost_price ?? "")) set.unit_cost = numOrNull(after.cost_price);
      let update = function (cb) {
        if (!Object.keys(set).length) return cb();
        batchesDB.update({ _id: current._id }, { $set: set }, {}, cb);
      };
      // a new product barcode: its price codes follow ("<barcode>-2", ...)
      let oldBase = productBaseCode(before);
      let newBase = productBaseCode(after);
      let renameCodes = function (cb) {
        if (oldBase === newBase) return cb();
        async.eachSeries(
          batches.filter((b) => b.barcode === oldBase || String(b.barcode || "").startsWith(oldBase + "-")),
          function (b, next) {
            batchesDB.update({ _id: b._id }, { $set: { barcode: newBase + String(b.barcode).slice(oldBase.length) } }, {}, next);
          },
          cb
        );
      };
      update(function (err) {
        if (err) return finish(err);
        renameCodes(function (err) {
          if (err) return finish(err);
          reconcileProduct(after._id, who, finish);
        });
      });
    });
  });
}
