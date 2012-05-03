var config = {
  listen_address: null,
  target_port: 2001,
  target_server: '127.0.0.1',

  proxy: {
    '127.0.0.1:2056': 2055
  },
  rproxy: {
    9001: '127.0.0.1:9100'
  }
};

var net = require('net');
var log = require('./log');

/*
 * General client func, send service_id first, then config_str
 * call callbacks when it's time.
 */
function mux_client(service_id, config_str, callback) {
  var socket_client = net.connect(config.target_port, config.target_server, function() {
    socket_client.write(service_id); // send service id

    var state = 0;
    socket_client.on('data', function(chunk) {
      if (state < 2) {
        if (chunk == 'cont') {
          if (state == 0) { // service id ok, send config
            socket_client.write(config_str); 
            state = 1;
          } else if (state == 1) { // config ok, continue to data
            state = 2;
            if (callback.established_callback) {
              callback.established_callback(socket_client);
            }
          }
        } else { // didn't receive 'cont', end the connection
          socket_client.end();
          if (callback.error_callback) {
            callback.error_callback(chunk.toString());
          }
        }      
      } else { // real data
        if (callback.data_callback) {
          callback.data_callback(chunk);
        }
      }
    });
  });

  socket_client.on('error', function(e) {
    socket_client.end();
    if (callback.socket_error_callback) {
      callback.socket_error_callback(e);
    }
  });

  return socket_client;
}

//------------------------------------------------------------------------------

/*
 * process the proxy queue in async manner
 */
function process_proxy_queue_async(queue, socket_client) {
  process.nextTick(function tickServePrinter() {
    process_proxy_queue(queue, socket_client);
  });    
}

/*
 * each proxy will start to work no matter if we can connect to the mux_server
 * the proxy will save received data into a queue. on client disconnection, 
 * we will push a null into queue to let the queue quit.
 * NEED to have a valid mux_server connection before call this func.
 */
function process_proxy_queue(queue, socket_client) {
  var buffer = queue.shift();
  if (typeof buffer == 'undefined') {
    process_proxy_queue_async(queue, socket_client);
    return;
  }

  if (buffer === null) {
    socket_client.end();
    log.info('process_proxy_queue: received null, ending connection to server');
  } else {
    socket_client.write(buffer);
    process_proxy_queue_async(queue, socket_client);
  }
}

/*
 * start a proxy and listen on port
 */
function start_proxy(port, target_conf) {
  var server = net.createServer(function(socket) {
    var queue = [];

    // the data may arrive before we make the connection to mux_server
    // so we push it into a queue
    socket.on('data', function(chunk) {
      queue.push(chunk);
    });

    // when the client disconnects, we push a null into queue
    socket.on('end', function() {
      log.info('start_proxy: connection from client ended, push null to queue');
      queue.push(null);
    });

    log.info('start_proxy: configuration ' + target_conf);
    mux_client('proxy', target_conf, {
      established_callback: function(socket_client) {
        log.info('start_proxy: connected with mux_server for ' + target_conf);
        process_proxy_queue(queue, socket_client);
      },
      error_callback: function() {
        socket.end();
      },
      data_callback: function(chunk) {
        socket.write(chunk);
      },
      socket_error_callback: function(e) {
        log.error('start_proxy: cannot run proxy with error: ' + 
                   e + 
                  ', restart all proxies');
      }
    });
  });

  server.listen(port, config.listen_address, function() {
    log.info('start_proxy: listening on ' + 
              config.listen_address + ':' + port + 
              ' for ' + target_conf);
  });
}

/*
 * start all proxies
 */
function start_proxies() {
  log.info('start_proxies: starting');
  for (var key in config.proxy) {
    var port = config.proxy[key];
    start_proxy(port, key);
  }
}

//------------------------------------------------------------------------------

/*
 * generate a reverse proxy configuration JSON object
 */
function generate_rproxy_config() {
  var cfg = {
    ports: []
  };
  for (var port in config.rproxy) {
    cfg.ports.push(port);
  }
  return cfg;
}

/*
 * send reverse proxy configuration to mux_server
 */
function send_rproxy_config(callback)
{
  log.info('send_rproxy_config: sending reverse config');
  var cfg = generate_rproxy_config();

  mux_client('rproxycfg', JSON.stringify(cfg), {
    established_callback: function(socket_client) {
      log.info('send_rproxy_config: config ok: ' + JSON.stringify(cfg));
      if (callback) {
        callback();
      }
      socket_client.end();
    },
    socket_error_callback: function(e) {
      log.error('send_rproxy_config: error: ' + e + ', resend in 1 seconds');
      process.exit(-1);
    }
  });
}

//------------------------------------------------------------------------------

function connect_target(target_ip, target_port, socket_client) {
  var socket_target = net.connect(target_port, target_ip, function() {
    log.info('connect_target: target server ' + 
              target_ip + ':' + target_port + ' connected');
    socket_client.pipe(socket_target);
  });

  socket_target.on('error', function(e) {
    socket_target.end();
    log.info('connect_target: error connecting to ' + 
              target_ip + ':' + target_port + 
              ' with exception: ' + e);
    setTimeout(function() {
      socket_client.end();
    }, 1000);
  });

  socket_target.on('end', function() {
    log.info('connect_target: connection to ' + 
              target_ip + ':' + target_port + ' ends');
    setTimeout(function() {
      socket_client.end();
    }, 1000);    
  });
}

function connect_rproxy(port, target_ip, target_port) {
  var socket_client = mux_client('rproxy', port, {
    established_callback: function(socket_client) {
      log.info('connect_rproxy: port acknowledged');
      connect_target(target_ip, target_port, socket_client);
    },
  });

  socket_client.on('end', function() {
    log.info('connect_rproxy: server connection disconnected, reconnect.')
    connect_rproxy(port, target_ip, target_port);
  });
}

function connect_rproxies()
{
  log.info('connect_rproxies: connecting reverse proxies');
  for (var port in config.rproxy) {
    var target_a = config.rproxy[port].split(':');
    var target_ip = target_a[0];
    var target_port = target_a[1];
    connect_rproxy(port, target_ip, target_port);
  }  
}

//------------------------------------------------------------------------------

send_rproxy_config(function() {
  start_proxies();
  connect_rproxies();
});