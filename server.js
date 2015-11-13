"use strict";

var
  // config
  host = process.env.COUCHDB_HOST || 'couchdb.khresmoi.eu',
  port = 3000,

  // imports
  express = require('express'),
  uglify = require('express-uglify'),
  nano = require('nano')('http://' + host + ':5984'),
  db = nano.use('khresmoi_docs'),
  NodeCache = require("node-cache"),
  CronJob = require('cron').CronJob,
  constants = require("./server/constants.js"),
  version = require('./package.json').version,
  dashboard = require('./server/dashboard-server.js'),

  // check the cache every 60 minutes; cache views for 24 hours
  cache = new NodeCache({
    stdTTL: (24 * 60 * 60),
    checkperiod: (60 * 60)
  });

// app setup
var app = express();

app.set('view engine', 'jade');
app.set('views', __dirname + '/views');
var staticOptions = {
  maxAge: 86400000 /*one day */
};

app.use("/couchdb-viz/styles", express['static'](__dirname + '/styles', staticOptions));
app.use("/couchdb-viz/js-lib", express['static'](__dirname + '/js-lib', staticOptions));
app.use("/couchdb-viz/img", express['static'](__dirname + '/img', staticOptions));
app.use("/couchdb-viz/js", uglify.middleware({
  src: __dirname + '/js',
  logLevel: 'debug'
}));

dashboard(app, db);

// also run a cron to automatically query couchdb and update the cache at 4am
function updateTask() {
  console.log("Updating the cache...");
  cache.flushAll();
  constants.views.forEach(function(view) {
    lookupRows(view);
  });
}
var cronJob = new CronJob({
  cronTime: '0 0 4 * * *',
  onTick: updateTask,
  start: false,
  timeZone: 'UTC'
});
cronJob.start();
updateTask(); // run immediately as well

function lookupRows(view, onResult) {
  console.log(' looking up rows for view ' + view.id + '...');

  function transformRows(rows) {
    // optional transform function
    rows = view.transform ? view.transform(rows) : rows;

    return [view.header].concat(rows.map(function(item) {
      if (Array.isArray(item.value)) {
        // 2D array data
        return [item.key].concat(item.value);
      }
      return [item.key, item.value];
    }));
  }

  console.log(' checking the cache...');
  cache.get(view.id, function(err, value) {

    if (err) {
      console.log('  error: ' + err);
    } else if (Object.keys(value).length === 0) { // empty object; not cached

      console.log('  cached element not found for view ' + view.id + '; fetching from couchdb...');
      db.view(view.id, view.id, view.params, function(err, body) {
        if (err) {
          console.log('error: ' + err + ' for view ' + view.id);
        } else {
          console.log('   fetched from couchdb for view ' + view.id);
          var rows = transformRows(body.rows);
          var rowsAndTime = {
            time: new Date().getTime(),
            rows: rows
          };
          if (onResult) {
            onResult(rowsAndTime);
          }
          cache.set(view.id, rowsAndTime);
        }
      });
    } else { // already cached

      console.log('  found element in the cache for view ' + view.id);

      if (onResult) {
        onResult(value[view.id]);
      }
    }
  });
}

// set up the routes (i.e. which "html pages" route to each view)
constants.views.forEach(function(view) {

  function renderHtml(req, res) {

    console.log('get ' + view.page);

    res.render('index', {
      version: version,
      couchdbViews: constants.views,
      view: view
    });
  }

  function renderJson(req, res) {
    console.log('get ' + view.json);

    function renderRows(rowsAndTime) {

      var rows = rowsAndTime.rows;
      var time = rowsAndTime.time;

      console.log("    got " + rows.length + " rows for view " + view.id + ' with time ' + time);

      res.json({
        rows: rows,
        view: view,
        time: time
      });
    }
    lookupRows(view, renderRows);
  }

  app.get(view.page, renderHtml);
  app.get(view.json, renderJson);
});

// update the cache if requested
app.get('/couchdb-viz/update-me', function(req, res) {

  var viewId = req.param('viewId');

  cache.del(viewId);

  res.json({
    success: true
  });

});

// redirect the main page to the dashboard
['/', '/couchdb-viz', '/couchdb-viz/'].forEach(function(path) {
  app.get(path, function(req, res) {
    res.redirect('/couchdb-viz/dashboard.html');
  });
});

app.listen(port);
console.log('Listening on port ' + port);
