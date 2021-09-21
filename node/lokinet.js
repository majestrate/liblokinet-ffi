/** lokinet.js -- glue jizz for liblokinet native shit */

import bindings from 'bindings';
import fetch from 'node-fetch';

import { readFile } from 'fs/promises';

import { connect } from 'net';
import { Agent, get } from 'http';
import { inherits } from 'util';
import { EventEmitter } from 'events';

const lokinet = bindings('liblokinet_js');

export class Lokinet
{

  /// @brief construct a lokinet
  /// @params opts can be null or a dict with the keys `bootstrap` which points to the bootstrap.signed file
  constructor(opts)
  {
    this._opts = opts || {};
    this._ctx = null;
  }

  /// @brief start lokinet
  async start()
  {
    if(this._ctx)
    {
      this.stop();
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
    this._ctx.stop();
    this._ctx = null;
  }

  /// @brief get our .loki address
  get hostname()
  {
    return this._ctx.addr();
  }

  /// @brief connect to host:port with a connect callback
  connect(port, host, callback)
  {
    const stream_info = this._ctx.outbound_stream(`${host}:${port}`);
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
  agent(options)
  {
    return new _Agent(this, options);
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

const runit = async () => {

  let ctx = new Lokinet();

  await ctx.start();
  console.log(`we are ${ctx.hostname}`);

  // make an http agent
  const agent = ctx.agent();

  // do a get request
  const req = get({
    hostname: "dw68y1xhptqbhcm5s8aaaip6dbopykagig5q5u1za4c7pzxto77y.loki",
    path: "/",
    agent: agent
  });
  req.on('response', (resp) => {
    resp.on("data", (data) => {
      console.log("got data");
      console.log(data.toString());
    });
    resp.on("end", () => {
      ctx.stop();
    });
  });
  req.end();
};

// await runit();
