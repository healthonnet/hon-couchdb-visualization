/*export CouchdbViz*/

var CouchdbViz = {};
(function($) {
    "use strict";

    var chartDiv = $('#chart_div');
    var loaderDiv = $('#loader');
    var timeSpan = $('#update-time');
    var updateLink = $('#update-me');
    var showWhileLoading = $('.show-while-loading');
    var hideWhileLoading = $('.hide-while-loading');

    CouchdbViz.updateTimeDisplay = function(time, view) {

        timeSpan.text("Data shown from " + moment(time).format('MMM Do YYYY, HH:mm [UTC]Z') + ". ");
        updateLink.click(function(e){

            $.getJSON('update-me', {viewId : view.id}, function(data){
                if (data.success) {
                    CouchdbViz.loadChartData(view.json);
                }
            });

            e.preventDefault();
        });

    };

    CouchdbViz.drawChart = function(response, onDraw) {

        var rows = response.rows;
        var time = response.time;
        var view = response.view;

        function createChart() {

            switch (view.chartType){
                case 'line':
                    return new google.visualization.LineChart(chartDiv[0]);
                case 'table':
                    return new google.visualization.Table(chartDiv[0]);
                case 'column':
                    return new google.visualization.ColumnChart(chartDiv[0]);
                default: // pie
                    return new google.visualization.PieChart(chartDiv[0]);
            }
        }

        function draw() {

            var data = google.visualization.arrayToDataTable(rows);

            var options = {
                title           : view.name,
                fontSize        : 11,
                titleTextStyle  : {fontSize : 14},
                height          : 475,
                sortAscending   : false,
                sortColumn      : 1,
                backgroundColor : '#f6f6f6',
                hAxis           : {title: rows[0][0]}
            };

            onDraw();

            var chart = createChart();
            chart.draw(data, options);
        }
        google.load("visualization", "1", {packages:["corechart", "table"], callback : draw});

        CouchdbViz.updateTimeDisplay(time, view);
    };

    CouchdbViz.loadChartData = function(pathname) {

        showWhileLoading.show();
        hideWhileLoading.hide();

        $.getJSON(pathname, function(data){
            CouchdbViz.drawChart(data, function onDraw(){
                showWhileLoading.hide();
                hideWhileLoading.show();
            });
        });
    };

})(jQuery);