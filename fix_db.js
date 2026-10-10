const { app } = require('electron');
const path = require('path');
const Store = require('electron-store');
const StoreClass = Store.default || Store;
const store = new StoreClass({ name: 'app-config' });
const dataRoot = store.get('dataRoot') || path.join(app.getPath('home'), 'Nexora');

const util = require('util');
util.isDate = (v) => v instanceof Date;
util.isArray = Array.isArray;
util.isRegExp = (v) => v instanceof RegExp;

const Datastore = require('nedb');

const customersDbPath = path.join(dataRoot, 'POS/server/databases/customers.db');
const customersDb = new Datastore({filename: customersDbPath, autoload: true});

const transactionsDbPath = path.join(dataRoot, 'POS/server/databases/transactions.db');
const transactionsDb = new Datastore({filename: transactionsDbPath, autoload: true});

// 1. Create a mock customer
const mockCustomer = {
  _id: Date.now().toString(),
  name: 'Test Customer',
  phone: '1234567890',
  email: 'test@example.com',
  address: '123 Test St'
};

customersDb.insert(mockCustomer, (err, insertedCustomer) => {
  if (err) console.error(err);
  
  // 2. Create a mock credit transaction for this customer
  const mockTransaction = {
    order: Math.floor(Date.now() / 1000),
    ref_number: "",
    discount: "",
    customer: insertedCustomer,
    status: 0,
    subtotal: "150.00",
    tax: 0,
    order_type: 1,
    items: [
      {
        id: 1786651972,
        product_name: "Mock Product",
        price: "150",
        img: "",
        quantity: 1
      }
    ],
    date: new Date(),
    payment_type: "Credit",
    payment_info: "",
    total: "150.00",
    paid: "",
    change: "",
    _id: Math.floor(Date.now() / 1000),
    till: 1,
    user: "Administrator",
    user_id: 1
  };

  transactionsDb.insert(mockTransaction, (err, doc) => {
    if (err) console.error(err);
    console.log("Mock data inserted successfully!");
    app.quit();
  });
});
