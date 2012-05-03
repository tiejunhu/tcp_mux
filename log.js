var DEBUG = 0;
var INFO = 1;
var WARN = 2;
var ERROR = 3;

var levelStrings = ["DEBUG", "INFO ", "WARN ", "ERROR"];

var globalLevel = DEBUG;

function ensure2(num) {
  if (num < 10) {
    return "0" + num;
  }
  return "" + num;
}

function ensure3(num) {
  if (num < 10) {
    return "00" + num;
  }
  if (num < 100) {
    return "0" + num;
  }
  return "" + num;
}

function formatDate(date) {
  var year_str = "" + date.getFullYear();
  var month_str = ensure2(date.getMonth() + 1);
  var day_str = ensure2(date.getDate());
  var hour_str = ensure2(date.getHours());
  var min_str = ensure2(date.getMinutes());
  var sec_str = ensure2(date.getSeconds());
  var msec_str = ensure3(date.getMilliseconds());

  return year_str + "-" + month_str + "-" + day_str + " " + hour_str + ":" + min_str + ":" + sec_str + "." + msec_str;
}

function log(level, msg) {
  if (level < globalLevel) {
    return;
  }
  var date = formatDate(new Date());
  var level_str = levelStrings[level];

  console.log(date + " " + level_str + "  " + msg);
}

function debug(msg) {
  log(DEBUG, msg);
}

function info(msg) {
  log(INFO, msg);
}

function warn(msg) {
  log(WARN, msg);
}

function error(msg) {
  log(ERROR, msg);
}

exports.globalLevel = globalLevel;
exports.DEBUG = DEBUG;
exports.INFO = INFO;
exports.WARN = WARN;
exports.ERROR = ERROR;

exports.log = log;
exports.debug = debug;
exports.info = info;
exports.warn = warn;
exports.error = error;