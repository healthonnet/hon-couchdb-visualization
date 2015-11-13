"use strict";

var constants = require('./constants.js');
var moment    = require('moment');
var version   = require('../package.json').version;
var _         = require('underscore');

/*
 * Map/reduce with multiple keys, simply counting the number of values for each key.  Returns an object
 */
function reduceAndCount(arr, funcOrProp) {

    var result = {};
    arr.forEach(function(element){
        var key = (typeof funcOrProp === 'function') ? funcOrProp(element) : element[funcOrProp];
        result[key] = (result[key] || 0) + 1;
    });
    return result;
}

module.exports =  function(app, db) {

    // dashboard
    app.get('/couchdb-viz/dashboard.html', function(req, res) {
        console.log('get dashboard.html');
        res.render('dashboard', {
            version         : version,
            couchdbViews    : constants.views,
            view            : {id : 'dashboard'}
        });

    });

    // dashboard feed
    app.get('/couchdb-viz/dashboard-feed', function(req, res){
        console.log('get dashboard-feed');
        db.view('by_date_filtered', 'by_date_filtered', req.query, function(err, body){
            if (err || !body || !body.rows) {
                return res.json({err : true});
            }

            var docs = _.pluck(body.rows, 'doc');

            // convert the couchdb docs into a summary view
            var hourCounts = reduceAndCount(docs, function(element){
                return moment(element.sourceMTime * 1000).zone(0).format('MMM DD YYYY HH[:00:00]');
            });
            var sourceCounts = reduceAndCount(docs, function(element){
                return element.facets.source_hes ? 'HES' : (element.facets.source_hon ? 'HON' : 'Unknown');
            });
            var languageCounts = reduceAndCount(docs, function(element){
                return element.language + ' (' + constants.langs[element.language] + ')';
            });

            var timestamps = _.pluck(docs, 'sourceMTime');
            var earliestTimestamp = _.min(timestamps) * 1000;
            var latestTimestamp = _.max(timestamps) * 1000;

            res.json({
                numDocuments      : parseInt(req.query.limit, 10),
                earliestTimestamp : earliestTimestamp,
                latestTimestamp   : latestTimestamp,
                counts : {
                    domain    : reduceAndCount(docs, 'domain'),
                    host      : reduceAndCount(docs, 'host'),
                    language  : languageCounts,
                    source    : sourceCounts,
                    hour      : hourCounts
                },
                next           : {
                    startkey       : body.rows[body.rows.length - 1].key,
                    startkey_docid : body.rows[body.rows.length - 1].id
                }
            });
        });

    });

};
