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
  constructor(opts)
  {
    this._opts = opts || {};
    this._ctx = null;
    this._hasExternal = false;
    this._checkedExternal = false;
  }

  /// @brief get the local lokinet ip
  async localip()
  {

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
      return "127.0.0.1";
  }

  async _checkForExternalLokinet()
  {
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
    if(this._ctx)
    {
      this._ctx.stop();
      this._ctx = null;
    }
  }

  /// @brief get our .loki address
  async hostname()
  {
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
    return new _Agent(this, options);
  }

  httpsAgent(options)
  {
    return new _SecureAgent(this, options);
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