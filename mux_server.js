var config = {
  host: null,
  port: 2001
}

var net = require('net');
var log = require('./log');

var mappings = {
  proxy: proxy,
  rproxy: rproxy,
  rproxycfg: rproxy_config
}

var proxy_config = {}

function proxy(socket, chunk)
{
  var config = proxy_config[socket];
  if (config) {
    return;
  }

  config = {};
  array = chunk.toString().split(':');

  if (array.length == 2) {
    config.target = array[0];
    config.port = array[1];
    log.info('received proxy config ' + config.target + ':' + config.port)
    var client_socket = net.connect(config.port, config.target, function() {
      proxy_config[socket] = config;
      socket.write('cont');
      client_socket.pipe(socket);
      socket.pipe(client_socket);
      log.info('proxy to ' + config.target + ':' + config.port)
    });
  } else {
    log.warn('proxy config error: ' + chunk.toString());
    socket.end();
  }

  socket.on('end', function() {
    delete proxy_config[socket];
  });
}

var rproxy_servers = {};
var rproxy_queue = {};
var rproxy_socket = {};
var rproxy_client_socket = {};

function rproxy(socket, chunk)
{
  port = chunk.toString();

  log.info('received rproxy port ' + port);

  rproxy_client_socket[port] = socket;

  socket.write('cont');
}

function process_rproxy_queue_async(port) {
  process.nextTick(function() {
    process_rproxy_queue(port);
  });
}

function process_rproxy_queue(port) {
  if (!rproxy_client_socket[port]) {
    setTimeout(function() {
      process_rproxy_queue_async(port);
    }, 10);
    return;
  }

  var buffer = rproxy_queue[port].shift();

  if (typeof buffer == 'undefined') { // empty queue
    setTimeout(function() {
      process_rproxy_queue_async(port);
    }, 10);
    return;
  }

  if (buffer === null) {
    rproxy_client_socket[port].end();
    delete rproxy_client_socket[port];
  } else {
    rproxy_client_socket[port].write(buffer);
  }

  process_rproxy_queue_async(port);
}

function start_rproxy_servers(ports)
{
  for (var i in ports) {
    var port = ports[i];
    rproxy_queue[port] = [];

    var server = net.createServer(function(socket) {
      if (rproxy_socket[port]) {
        socket.end();
        return;
      }

      rproxy_socket[port] = socket;

      socket.on('data', function(chunk) {
        rproxy_queue[port].push(chunk);
      });

      socket.on('end', function() {
        rproxy_queue[port].push(null);
        delete rproxy_socket[port];
      });

    });

    server.listen(port, config.host, function() {
      rproxy_servers[port] = server;
      host = config.host;
      if (host == null) {
        host = '*';
      }
      log.info('rproxy server running at ' + host + ':' + port);
    });

    process_rproxy_queue_async(port);
  }
}

function stop_rproxy_servers()
{
  for (var port in rproxy_servers) {
    var server = rproxy_servers[port];
    server.close();
  }
  rproxy_servers = {};
  rproxy_queue = {};
  rproxy_socket = {};
}

function rproxy_config(socket, chunk)
{
  var new_rproxy_config_string = chunk.toString();

  var cfg = JSON.parse(new_rproxy_config_string);
  log.info('received rproxy config ' + new_rproxy_config_string);
  socket.end('cont');
  stop_rproxy_servers();
  start_rproxy_servers(cfg.ports);
}

var server = net.createServer(function(socket) {
  var func = null;
  socket.on('data', function(chunk) {
    if (func === null) {
      func = mappings[chunk];
      if (func === null) {
        log.warn('terminating request of ' + chunk.toString());
        socket.end();
      } else {
        socket.write('cont');
      }
    } else {
      func(socket, chunk);      
    }
  });
});

server.listen(config.port, config.host, function() {
  host = config.host;
  if (host == null) {
    host = '*';
  }
  log.info('server running at ' + host + ':' + config.port);
});
