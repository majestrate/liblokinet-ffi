/** lokinet.js -- glue jizz for liblokinet native shit */

/*
import bindings from 'bindings';
import { readFile } from 'fs/promises';
import { connect } from 'net';
import { Agent } from 'https';

const lokinet = bindings('liblokinet_js');

import { promises } from 'dns';
const dns = promises;
*/

const lokinet = require('bindings')('liblokinet_js');
const readFile = require('fs').promises.readFile;
const connect = require('net').connect;
const TLSSocket = require('tls').TLSSocket;
const Agent = require('http').Agent;
const SecureAgent = require('https').Agent;
const dns = require('dns').promises;
const dgram = require('dgram');

const _resolver = new dns.Resolver();
// TODO: fedora is fucking retarded and cannot bind to port 53
_resolver.setServers(['127.3.2.1', '127.0.0.1']);


/// @brief turn hex to base32z
const hex_to_base32z = lokinet.hex_to_base32z;

//// @brief a lokinet wrapper that will spawn a liblokinet if an external lokinet is not detected
class Lokinet
{

  /// @brief construct a lokinet context, if a lokinet is detected externally it will use it
  /// @params opts can be null or a dict with the keys `bootstrap` which points to the bootstrap.signed file
  /// @params opts if opts contains alwaysEmbed and is set to true we will always use liblokinet embeded mode
  /// @params opts if opts has a function called log it will use that as the lokinet logging function
  constructor(opts)
  {
    this._opts = opts || {};
    this._ctx = null;
    this._hasExternal = false;
    this._checkedExternal = false;
  }

  _log(msg)
  {
    if(this._opts.log)
      this._opts.log(`[liblokinet] ${msg}`);
    else
      console.log(msg);
  }

  /// @brief get the local lokinet ip
  async localip()
  {
    this._log("localip");
    if(this._opts.alwaysEmbed)
    {
      return "127.0.0.1";
    }
    let addrs = [];

    try
    {
      addrs = await _resolver.resolveCname("localhost.loki");
    }
    catch(e) {};

    if(addrs.length > 0)
    {
      const localaddrs = await _resolver.resolve(addrs[0]);
      return localaddrs[0];
    }
    else
      throw "cannot get local ip";
  }

  async _checkForExternalLokinet()
  {
    this._log("checkForExternalLokinet");
    let addrs  = [];
    try
    {
      addrs = await _resolver.resolveCname("localhost.loki");
    }
    catch(e) {};
    return addrs.length > 0;
  }

  /// @brief start lokinet
  async start()
  {
    this._log("start");
    if(this._opts.alwaysEmbed)
    {
      // skip embedded check if we are configured to always run as embedded
    }
    else if(this._checkedExternal)
    {
      return;
    }
    else
    {
      this._checkedExternal = true;
      this._hasExternal = await this._checkForExternalLokinet();
      if(this._hasExternal)
        return;
    }

    if(this._ctx)
    {
      return;
    }


    // lokinet.set_logger(this._log);

    this._ctx = new lokinet.Context();


    const bootstrap = this._opts.bootstrap || "bootstrap.signed";
    const data = await readFile(bootstrap);
    const rc = new Uint8Array(data).buffer;
    this._ctx.bootstrap(rc);
    this._ctx.start();

  }

  /// @brief stop lokinet
  stop()
  {
    this._log("start");
    if(this._ctx)
    {
      this._ctx.stop();
      this._ctx = null;
    }
  }

  /// @brief get our .loki address
  async hostname()
  {
    this._log("hostname");
    if(this._hasExternal)
    {
      const addrs = await _resolver.resolveCname("localhost.loki");
      return addrs[0];
    }
    else
      return this._ctx.addr();
  }

  /// @brief connect to host:port with a connect callback
  connect(port, host, callback)
  {
    this._log("connect");
    if(this._hasExternal)
    {
      return this._connectExternal(port, host, callback);
    }
    else
      return this._connectEmbedded(port, host, callback);
  }

  _connectExternal(port, host, callback)
  {
    return connect(port, host, callback);
  }

  _connectEmbedded(port, host, callback)
  {
    const stream_info = this._ctx.outbound_stream(`${host}:${port}`);
    console.log(`embedded via ${stream_info.host}:${stream_info.port}`);
    const conn = connect(stream_info.port, stream_info.host, callback);
    conn.on("error", (err) => {
      console.log(err);
      conn.end();
    });
    conn.on('end', () => {
      if(this._ctx)
      {
        this._ctx.close_stream(stream_info.id);
      }
    });
    return conn;
  }

  /// @brief make an http.Agent that uses lokinet
  httpAgent(options)
  {
    this._log("httpAgent");
    return new _Agent(this, options);
  }

  httpsAgent(options)
  {
    this._log("httpsAgent");
    return new _SecureAgent(this, options);
  }

  _make_udp_socket(socket_id, remote_host, remote_port, local_ip, local_port)
  {
    this._log("_make_udp_socket");
    const c_socket = dgram.createSocket('udp4');
    const recv = (pkt_info) => {
      c_socket.sendto(Buffer.from(pkt_info.data), local_port, local_ip);
    };
    const timeout = (info) => {
      this._log(`udp stream timed out: ${info.host}:${info.port}`);
      c_socket.close();
    };
    c_socket.on('message', (msg, rinfo) => {
      this._ctx.udp_flow_send(msg, socket_id, remote_port, remote_host);
    });
    c_socket.bind(0, local_ip);
    c_socket.on('error', () => {
      c_socket.close();
    });
    return [c_socket, recv, timeout];
  }

  /// @brief bind udp socket on our .loki address on port
  /// does nothing for external lokinet
  /// @return a udp socket id for use
  async udpIntercept(port, toHost)
  {
    this._log("udpIntercept");
    if(this._hasExternal)
      return new Promise((resolve, reject) => { resolve(null); });
    const ip = toHost;
    const udp = dgram.createSocket('udp4');
    let bindsock = (sock, resolve, reject) => {
      sock.bind(0, ip, () => {

        const socket_id = this._ctx.udp_bind(port, (info) => {
          return this._make_udp_scoket(info.socket_id, info.host, info.port, ip, port).slice(1);
        });
        sock.on('close', () => {
          this._ctx.udp_close(socket_id);
        });

        if(socket_id == 0)
        {
          reject("could not bind");
          return;
        }
        resolve(socket_id);
      });
    };
    return new Promise((resolve, reject) => {
        bindsock(udp, resolve, reject);
    });
  }

  /// @brief given a udp hostname and port turn it into an [ip, port]
  async resolveUDP(socket_id, host, port)
  {
    this._log("resolveUDP");
    if(socket_id)
    {
      const localip =  await this.localip();
      return new Promise((resolve, reject) => {
        let obj = {};
        try
        {
          const infos = this._make_udp_socket(socket_id, host, port, localip, port);
          resolve([localip, infos[0].address().port]);

        }
        catch(ex)
        {
          reject(ex)
        }
      });
    }
    else
    {
      const addrs = await _resolver.resolve(host);
      return [addrs[0], port];
    }
  }

  /// @brief expose udp ip:port on lokinet via exposePort
  /// @return socket id
  async permitInboundUDP(port, ip, exposePort)
  {
    const on_new_flow = (info) => {
      const sock = dgram.createSocket('udp4');
      const remotehost = info.host;
      const remoteport = info.port;
      const socket_id = info.id;

      sock.bind(exposePort, ip);

      const timeout = (info) => {
        this._log(`socket timeout: ${info.host}`);
        sock.close();
      };

      sock.on("message", (msg, rinfo) => {
        this._log(`sock got msg: ${msg}`);
        this._ctx.udp_flow_send(msg, socket_id, remotehost, remoteport);
      });

      const recv = (pkt_info) => {
        this._log(`sock send msg to ${ip}:${port}`);
        sock.sendto(pkt_info.data, port, ip);
      };

      return [recv, timeout];

    };
    return this._ctx.udp_bind(exposePort, on_new_flow);
  }

  /// @brief permit inbound tcp stream on port
  /// @return a function to unmap the stream
  async permitInboundTCP(port)
  {
    this._log("permitInboundTCP");
    return new Promise((resolve, reject) => {
      var id;
      if(!this._hasExternal)
      {
        id = this._ctx.inbound_stream(port);
      }
      resolve(() => {
        if(id)
          this._ctx.close_stream(id);
      });
    });
  }

};

class _Agent extends Agent
{
  constructor(lokinet, options)
  {
    super(options);
    this._ctx = lokinet;
  }

  createConnection(options, callback)
  {
    const conn = this._ctx.connect(options.port || 80, options.host, () => {
      if(callback)
      {
        callback(null, conn);
      }
    });
    return conn;
  }
};

class _SecureAgent extends SecureAgent
{
  constructor(lokinet, options)
  {
    super(options);
    this._ctx = lokinet;
  }

  createConnection(options, callback)
  {
    const conn = new TLSSocket(this._ctx.connect(options.port || 443, options.host, () => {
      if(callback) callback(null, conn);
    }));
    return conn;
  }
}

module.exports = {
  "Lokinet": Lokinet,
  "hex_to_base32z": hex_to_base32z
};
