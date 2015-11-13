"use strict";

var querystring = require("querystring");

/* collapse by the keys in the array and sum together the values */
function collapseKeysAndSum(inputArray, keyCollapseFunction) {

    var map = {};
    inputArray.forEach(function(element) {
        var key = keyCollapseFunction ? keyCollapseFunction(element.key) : element.key;
        if (map[key]) {
            map[key] += element.value;
        } else {
            map[key] = element.value;
        }
    });
    
    var keys = Object.keys(map);
    keys.sort();
    
    return keys.map(function(key) {
       return {key : key, value : map[key]};
    });
}

// friendly names for ISO 2-digit languages
var langs = {
    'ar' : '\u0627\u0644\u0639\u0631\u0628\u064a\u0629',
    'bg' : '\u0431\u044a\u043b\u0433\u0430\u0440\u0441\u043a\u0438',
    'cs' : '\u010de\u0161tina',
    'da' : 'dansk',
    'de' : 'Deutsch',
    'el' : '\u03b5\u03bb\u03bb\u03b7\u03bd\u03b9\u03ba\u03ac',
    'en' : 'English',
    'es' : 'espa\xf1ol',
    'et' : 'eesti keel',
    'fi' : 'suomi',
    'fr' : 'fran\xe7ais',
    'hr' : 'hrvatski',
    'hu' : 'magyar',
    'it' : 'italiano',
    'lt' : 'lietuvi\u0173 kalba',
    'lv' : 'latvie\u0161u valoda',
    'mt' : 'Malti',
    'nl' : 'Nederlands',
    'no' : 'norsk',
    'pl' : 'polski',
    'pt' : 'portugu\xeas',
    'ro' : 'rom\xe2n\u0103',
    'ru' : '\u0440\u0443\u0301\u0441\u0441\u043a\u0438\u0439',
    'sk' : 'sloven\u010dina',
    'sl' : 'sloven\u0161\u010dina',
    'sv' : 'svenska',
    'zh-tw' : '\u4e2d\u6587'
};

/*
 * Convert the CouchDB-style {key: ["foo","HON"], value: 12345},{key: ["foo","HES"], value: 67890} to 
 * the format accepted by Google Visualizations:
 
 * {key : ["foo"], value : [67890, 12345]}
 */

function createGoogleViz2DArray(inputArray) {
    // map key (e.g. month or domain) to source to count
    var keyMap = {};
    var sourcesMap = {};
    inputArray.forEach(function(element){
        var key = element.key[0];
        var source = element.key[1];
        var count = element.value;
        
        sourcesMap[source] = true;
        
        if (!keyMap[key]) {
            keyMap[key] = {};
        }
        keyMap[key][source] = count;
    });
    
    var sources = Object.keys(sourcesMap);
    sources.sort();
    
    var keys = Object.keys(keyMap);
    keys.sort();
    
    var outputArr = [];
    // convert map to sorted list
    keys.forEach(function(key) {
        var values = [];
        sources.forEach(function(source) {
            values.push(keyMap[key][source] || 0);
        });
        outputArr.push({key : key, value : values});
    });
    return outputArr;
}

function convertMonthsSinceEpochToPrettyString(monthsSinceEpoch) {

    var monthInt = monthsSinceEpoch % 12;
    var yearInt = Math.floor(monthsSinceEpoch / 12) + 1970;

    var month = (monthInt + 1).toString(10);
    if (month.length < 2) {
        month = '0' + month;
    }

    var yearAndMonth = yearInt.toString(10) + '-' + month;

    return yearAndMonth;
}

var APRIL_2012 = (((2012 - 1970) * 12) + 3);

// couchdb views to allow the user to browse
var views = [
    {
        name      : "HON-crawled images by month",
        shortName : "Images by month",
        header    : ['Month', 'Number of images'],
        params    : {stale : 'update_after', reduce : true, group : true, startkey : APRIL_2012},
        id        : 'num_images_by_month',
        chartType : 'line',
        transform : function(inputArray) {
            return inputArray.map(function(element){
                return {key : convertMonthsSinceEpochToPrettyString(element.key), value : element.value};
            });
        }
    },
    {
        name      : "Crawled HTML pages by month",
        shortName : "HTML pages by month",
        header    : ['Month', 'Number of HES-crawled HTML pages', 'Number of HON-crawled HTML pages'],
        params    : {stale : 'update_after', reduce : true, group : true},
        id        : 'num_html_docs_by_month_and_source',
        chartType : 'line',
        // put the array in the Google Visualization format described here:
        // https://developers.google.com/chart/interactive/docs/gallery/linechart
        transform : function(inputArray) {

            // hack just in case HES doesn't have any crawled docs
            inputArray.push({key : [APRIL_2012, "HES"], value: 0});

            inputArray.forEach(function(element){
                var monthAndSource = element.key;
                monthAndSource[0] = convertMonthsSinceEpochToPrettyString(monthAndSource[0]);
            });

            return createGoogleViz2DArray(inputArray);
        }
    },
    {
        name      : "All HTML docs by rounded relevancy score",
        shortName : "HTML pages by relevancy",
        header    : ['Rounded relevancy score', 'Number of HTML docs'],
        params    : {stale : 'update_after', reduce : true, group : true},
        id        : 'num_html_docs_by_rounded_relevancy_score',
        chartType : 'column',
        transform : function(inputArray) {

            var array = inputArray.slice();

            array.forEach(function(element){
                // combine some results for simpler display
                if (element.key > 20) {
                    element.key = ">20";
                }
            });

            array = collapseKeysAndSum(array);

            // sort by int value, not string value
            function parseIntOrMax(str) {
                var result = parseInt(str, 10);
                return isNaN(result) ? Number.MAX_VALUE : result;
            }
            array.sort(function(left, right){
                var leftInt = parseIntOrMax(left.key);
                var rightInt = parseIntOrMax(right.key);

                return leftInt === rightInt ? 0 : (leftInt < rightInt ? -1 : 1);
            });

            return array;
        }
    },
    {
        name      : "All docs by language",
        shortName : "Docs by language",
        header    : ['Language', 'Number of docs'],
        params    : {stale : 'update_after', reduce : true, group : true},
        id        : 'num_docs_by_language',
        chartType : 'pie',
        transform : function(inputArray) {
            return collapseKeysAndSum(inputArray, function(key){
                return (key && key !== '?') ? (key + ' (' + langs[(key)]+  ')') : 'Unknown';
            });
        }
    },
    {
        name      : "HON-crawled images by type",
        shortName : "Images by type",
        header    : ['Image type', 'Number of images'],
        params    : {stale : 'update_after', reduce : true, group : true},
        id        : 'num_images_by_image_type',
        chartType : 'pie',
        transform : function(inputArray) {
            var imageTypes = ["BMP", "GIF", "JPEG", "Other", "PNG", "TIFF"];
            return inputArray.map(function(element){
                // integer id used to save disk space
                return {key : (element.key === -1 ? "Unknown" : imageTypes[element.key]), value : element.value};
            });
        }
    },
    {
        name      : "All HTML docs by facet",
        shortName : "Docs by facet",
        header    : ['Facet', 'Number of HTML docs'],
        params    : {stale : 'update_after', reduce : true, group : true},
        id        : 'num_docs_by_facet',
        chartType : 'table',
        transform : function(inputArray) {
            return collapseKeysAndSum(inputArray);

        }
    },
    {
        name      : "All docs by domain",
        shortName : "Docs by domain",
        header    : ['Domain', 'Number of HES-crawled docs', 'Number of HON-crawled docs'],
        params    : {stale : 'update_after', reduce : true, group : true},
        id        : 'num_docs_by_domain_and_source',
        chartType : 'table',
        transform : function(inputArray) {
            
            // hack just in case HES doesn't have any crawled domains
            inputArray.push({key : ["?","HES"], value: 0});
            
            var filteredArray = inputArray.slice();   
              
            filteredArray.forEach(function(element){
                if (!element.key[0] || element.key[0] === '?') {
                    element.key = ["Unknown",element.key[1]];
                // don't show any domains with less than 100 results; it's boring
                } else if (element.value < 100) {   
                    element.key = ["(Other domains)",element.key[1]];
                }
            });
            
            var convertedArray = createGoogleViz2DArray(filteredArray);
            return collapseKeysAndSum(convertedArray);
            
        }
    }
];

// add in some useful precalculated data for each view
views.forEach(function(view) {
    view.page = '/couchdb-viz/' + view.id + '.html';
    view.json = '/couchdb-viz/' + view.id + '.json';
    
    // CouchDB has an idiotic system where strings have to be surrounded with quotes
    // for the rest API
    var params = {};
    Object.keys(view.params).forEach(function(key){
        var value = view.params[key];
        
        params[key] = (key === 'startkey' || key === 'endkey') ? JSON.stringify(value) : value;
    });
    
    view.querystring = querystring.stringify(params);
});

module.exports = {
    langs : langs,
    views : views
};