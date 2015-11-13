/**
 * Code for the dashboard view, which basically just polls the by_date view for recent changes and shows
 * aggregate views for that data
 */
(function($){
    "use strict";

    //
    // constants
    //

    var INITIAL_BATCH_SIZE = 10;
    var MAX_SERVER_RESPONSE_TIME = 10000;
    var RESPONSE_TIME_MARGIN = 1000;
    var BATCH_INCREMENT = 10;

    //
    // elements
    //

    var numLoadedDiv        = $('#num-loaded');
    var showWhileLoading    = $('.show-while-loading');
    var hideWhileLoading    = $('.hide-while-loading');
    var chartDomains        = $('#chart-domains');
    var chartLanguages      = $('#chart-languages');
    var chartHosts          = $('#chart-hosts');
    var chartSources        = $('#chart-sources');
    var chartHours          = $('#chart-hours');
    var chartSpeed          = $('#chart-speed-inner');
    var pauseIt             = $('#pause-it');
    var miniLoader          = $('#mini-loader');
    var downloadRawData     = $('#download-raw-data');
    var chartSpeedLoading   = $('#chart-speed-loading-overlay');

    //
    // variables
    //

    var numLoaded = 0;
    var startTimes = {};
    var requestId = 0;
    var counts = {};
    var paused = false;
    var batchSize = INITIAL_BATCH_SIZE;
    var latestTimestamp = 0;
    var earliestTimestamp = 0;
    var gaugeChartManager;
    var pieChartManagers;

    var params = {
        descending   : true,
        limit        : batchSize,
        include_docs : true,
        stale        : 'update_after'
    };

    //
    // init logic
    //
    poll();

    //
    // logic for fetching from the server to get chart data
    //

    function updateCounts(newCounts) {
        // add the two objects together
        _.forEach(_.keys(newCounts), function(key) {
            counts[key] = counts[key] || {};
            _.forEach(_.keys(newCounts[key]), function(subkey){
                counts[key][subkey] = (counts[key][subkey] || 0) + newCounts[key][subkey];
            });
        });
    }

    function updateBatchSize(currentRequestId) {
        // start off fetching 10 documents at a time, but later we can ramp up if the server responds in
        // less than a few seconds

        var startTime = startTimes[currentRequestId];
        var responseTime = new Date().getTime() - startTime;
        delete startTimes[currentRequestId];

        var fasterThanExpected = responseTime < MAX_SERVER_RESPONSE_TIME - RESPONSE_TIME_MARGIN;
        var slowerThanExpected = responseTime > MAX_SERVER_RESPONSE_TIME + RESPONSE_TIME_MARGIN;

        if (fasterThanExpected) {
            // can tolerate more latency
            batchSize += BATCH_INCREMENT;
        } else if (slowerThanExpected && batchSize > BATCH_INCREMENT) {
            // it's too slow, go back down
            batchSize -= BATCH_INCREMENT;
        }
    }

    function drawCharts(data) {
        // update the charts
        function drawAll() {

            gaugeChartManager = gaugeChartManager || new GaugeChartManager(chartSpeed);

            pieChartManagers = pieChartManagers || _.zip(
                    [chartDomains, chartLanguages, chartHosts, chartSources, chartHours],
                    ['Domains', 'Languages', 'Hosts', 'Sources (based on best guess)', 'Indexing time (by hour in GMT)']
                ).map(function(item){
                    var div = item[0];
                    var title = item[1];
                    return new PieChartManager(div, title);
                }
            );

            pieChartManagers[0].draw(counts.domain);
            pieChartManagers[1].draw(counts.language);
            pieChartManagers[2].draw(counts.host);
            pieChartManagers[3].draw(counts.source);
            pieChartManagers[4].draw(counts.hour);
            gaugeChartManager.draw(data);
        }

        google.load("visualization", "1", {packages:["corechart", "gauge"], callback : drawAll});
    }

    function poll() {

        var currentRequestId = requestId++;

        startTimes[currentRequestId] =  new Date().getTime();

        $.ajax({
            url : 'dashboard-feed',
            dataType : 'json',
            cache : false,
            data : params,
            success : function(data) {

                showWhileLoading.hide();
                hideWhileLoading.show();

                if (paused || !data.counts) { //error or paused, just stop
                    console.log('paused or no data counts');
                    return;
                }

                updateBatchSize(currentRequestId);

                updateCounts(data.counts);

                drawCharts(data);

                // read up on the startkey pattern for CouchDB to understand why we do paging like this
                params.skip = 1;
                params.startkey = data.next.startkey;
                params.startkey_docid = data.next.startkey_docid;
                params.limit = batchSize;

                numLoaded += data.numDocuments;
                numLoadedDiv.text(' ' + numLoaded + ' ');

                // just keep polling for forever
                poll();

            }
        });
    }

    //
    // click handlers
    //
    downloadRawData.click(function(e){
        e.preventDefault();

        var data = {
            counts            : counts,
            numLoaded         : numLoaded,
            earliestTimestamp : earliestTimestamp,
            latestTimestamp   : latestTimestamp
        };
        var base64Data = $.base64.encode(JSON.stringify(data, null, 4), {utf8encode : true});

        window.open('data:application/json;charset=utf-8;base64,' + base64Data);

    });

    pauseIt.click(function(e){
        e.preventDefault();

        paused = !paused;

        pauseIt.find('a').text(paused ? 'Resume' : 'Pause');
        miniLoader.toggleClass('paused', paused);

        if (!paused) { // unpaused, i.e. resumed
            poll();
        }
    });

    //
    // PieChartManager class
    //

    function PieChartManager(div, title) {
        this.chart = new google.visualization.PieChart(div[0]);
        this.title = title;
    }
    PieChartManager.prototype.draw = function(data) {

        function addCountsToLabels(str){
            return [str[0] + ' (' + str[1] + ')', str[1]];
        }

        var dataAsArray = [[this.title, "Counts"]].concat(_.pairs(data).map(addCountsToLabels));
        var chartData = google.visualization.arrayToDataTable(dataAsArray);

        var options = { title : this.title };
        this.chart.draw(chartData, options);
    };

    //
    // GaugeChartManager class
    //

    function GaugeChartManager(div) {
        var STARTING_MAX = 300;

        this.div = div;
        this.chart = new google.visualization.Gauge(div[0]);
        this.chartData = google.visualization.arrayToDataTable([
            ['Label', 'Value'],
            ['Docs/min', 0]
        ]);
        this.currentMax = STARTING_MAX;

    }
    GaugeChartManager.prototype.draw = function(data) {

        var RED_PERCENT = 0.85;
        var YELLOW_PERCENT = 0.7;

        //
        // draws the estimated indexing speed
        //

        if (earliestTimestamp === 0 || earliestTimestamp > data.earliestTimestamp) {
            earliestTimestamp = data.earliestTimestamp;
        }
        if (latestTimestamp === 0 || latestTimestamp < data.latestTimestamp) {
            latestTimestamp = data.latestTimestamp;
        }

        var estimatedSpeed;
        if (latestTimestamp === earliestTimestamp) {
            // not enough data to use for estimating
            estimatedSpeed = 0;
        } else {
            estimatedSpeed = numLoaded * 60000.0 / (latestTimestamp - earliestTimestamp);
        }

        this.chartData.setValue(0, 1, Math.round(estimatedSpeed));

        // increase the max for when the needle is over the max.  we can't "win" so easily, right? ;)
        var max = this.currentMax > estimatedSpeed ? this.currentMax : (1000 * Math.ceil(estimatedSpeed / 1000));

        var options = {
            min : 0, max : max,
            width: this.div.width(), height: this.div.height(),
            redFrom: Math.round(max * RED_PERCENT), redTo: max,
            yellowFrom: Math.round(max * YELLOW_PERCENT), yellowTo: Math.round(max * RED_PERCENT),
            minorTicks: 10,
            animation : {
                duration : 1000,
                easing   : 'inAndOut'
            }
        };
        this.chart.draw(this.chartData, options);

        this.currentMax = max;

        if (estimatedSpeed > 0) {
            chartSpeedLoading.hide();
        }
    };

})(jQuery);
