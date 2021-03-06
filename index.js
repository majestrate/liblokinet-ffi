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

let lokinet = null;
let hex_to_base32z = (str) => {};
let set_log_level = (str) => {};

try {
    lokinet = require('bindings')('liblokinet_js');
} catch (ex) {
    console.log(`cannot load native library: ${ex}`);
};

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


if (lokinet) {
    hex_to_base32z = lokinet.hex_to_base32z;
    set_log_level = lokinet.set_log_level;
}

const SDP = require('sdp');


/// get the ip/port of the first ice candidate in this data
const _extractAddrFromSDPData = (sdp) => {
    const lines = SDP.splitLines(sdp);
    for (let line of lines) {
        if (line.indexOf('a=') != 0)
            continue;
        const parsed = SDP.parseCandidate(line);
        return [parsed.ip, parsed.port];
    }
    throw 'invalid sdp data';
};


/// set remote ip/port of an sdp data blob, return a new one with the new data
const _rewriteSDPAddr = (sdp, newaddr, newport) => {
    let rewritten = '';
    const lines = SDP.splitLines(sdp);
    for (let line of lines) {
        if (line.indexOf('a=') == 0) {
            let parsed = SDP.parseCandidate(line);
            parsed.ip = newaddr;
            parsed.port = newport;
            line = SDP.writeCandidate(parserd);
        }
        rewritten += `${line}\r\n`;
    }
    return rewritten;
};

//// @brief a lokinet wrapper that will spawn a liblokinet if an external lokinet is not detected
class Lokinet {

    /// @brief construct a lokinet context, if a lokinet is detected externally it will use it
    /// @params opts can be null or a dict with the keys `bootstrap` which points to the bootstrap.signed file
    /// @params opts if opts contains alwaysEmbed and is set to true we will always use liblokinet embeded mode
    /// @params opts if opts has a function called log it will use that as the lokinet logging function
    constructor(opts) {
        this._opts = opts || {};
        this._ctx = null;
        this._hasExternal = false;
        this._checkedExternal = false;
    }

    /// @brief returns true if we are using an external lokinet
    hasExternal() {
        return this._hasExternal;
    }

    _shouldEmbed() {
        if (lokinet == null)
            return false;
        return this._opts.alwaysEmbed;
    }

    _log(msg) {
        if (this._opts.log)
            this._opts.log(`[liblokinet] ${msg}`);
        else
            console.log(msg);
    }

    /// @brief get the local lokinet ip
    async localip() {
        this._log("localip");
        if (this._shouldEmbed()) {
            return "127.0.0.1";
        }
        let addrs = [];

        try {
            addrs = await _resolver.resolveCname("localhost.loki");
        } catch (e) {};

        if (addrs.length > 0) {
            const localaddrs = await _resolver.resolve(addrs[0]);
            return localaddrs[0];
        } else
            throw "cannot get local ip";
    }

    async _checkForExternalLokinet() {
        this._log("checkForExternalLokinet");
        let addrs = [];
        try {
            addrs = await _resolver.resolveCname("localhost.loki");
        } catch (e) {};
        return addrs.length > 0;
    }

    /// @brief start lokinet
    async start() {
        this._log("start");
        if (this._shouldEmbed()) {
            // skip embedded check if we are configured to always run as embedded
        } else if (this._checkedExternal) {
            // if we already checked for an external address we gud
            return;
        } else {
            // check for our external address
            this._checkedExternal = true;
            this._hasExternal = await this._checkForExternalLokinet();
            if (this._hasExternal)
                return;
        }

        if (this._ctx) {
            return;
        }


        // lokinet.set_logger(this._log);

        if (lokinet == null)
            throw "external lokinet not up and we cannot embed lokinet";

        this._ctx = new lokinet.Context();

        if (this._opts.bootstrapBase64Data) {
            const rc = new Buffer(this._opts.bootstrapBase64Data, 'base64');
            this._ctx.bootstrap(rc);
        } else {
            const bootstrap = this._opts.bootstrap || "bootstrap.signed";
            const data = await readFile(bootstrap);
            const rc = new Uint8Array(data).buffer;
            this._ctx.bootstrap(rc);
        }
        this._ctx.start();

    }

    /// @brief stop lokinet
    stop() {
        this._log("start");
        if (this._ctx) {
            this._ctx.stop();
            this._ctx = null;
        }
    }

    /// @brief get our .loki address
    async hostname() {
        this._log("hostname");
        if (this._hasExternal) {
            const addrs = await _resolver.resolveCname("localhost.loki");
            return addrs[0];
        } else
            return this._ctx.addr();
    }

    /// @brief connect to host:port with a connect callback
    connect(port, host, callback) {
        this._log("connect");
        if (this._hasExternal) {
            return this._connectExternal(port, host, callback);
        } else
            return this._connectEmbedded(port, host, callback);
    }

    _connectExternal(port, host, callback) {
        return connect(port, host, callback);
    }

    _connectEmbedded(port, host, callback) {
        const stream_info = this._ctx.outbound_stream(`${host}:${port}`);
        console.log(`embedded via ${stream_info.host}:${stream_info.port}`);
        const conn = connect(stream_info.port, stream_info.host, callback);
        conn.on("error", (err) => {
            console.log(err);
            conn.end();
        });
        conn.on('end', () => {
            if (this._ctx) {
                this._ctx.close_stream(stream_info.id);
            }
        });
        return conn;
    }

    /// @brief make an http.Agent that uses lokinet
    httpAgent(options) {
        this._log("httpAgent");
        return new _Agent(this, options);
    }

    httpsAgent(options) {
        this._log("httpsAgent");
        return new _SecureAgent(this, options);
    }

    _make_udp_socket(socket_id, remote_host, remote_port, local_ip, local_port) {
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
    async udpIntercept(port, toHost) {
        this._log("udpIntercept");
        if (this._hasExternal)
            return new Promise((resolve, reject) => {
                resolve(null);
            });
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

                if (socket_id == 0) {
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
    async resolveUDP(socket_id, host, port) {
        this._log("resolveUDP");
        if (socket_id) {
            const localip = await this.localip();
            return new Promise((resolve, reject) => {
                let obj = {};
                try {
                    const infos = this._make_udp_socket(socket_id, host, port, localip, port);
                    resolve([localip, infos[0].address().port]);

                } catch (ex) {
                    reject(ex)
                }
            });
        } else {
            const addrs = await _resolver.resolve(host);
            return [addrs[0], port];
        }
    }

    /// @brief expose udp ip:port on lokinet via exposePort on localport
    /// @return socket id
    permitUDP(port, ip, exposePort, localport) {
        const _on_new_flow = (info) => {
            const sock = dgram.createSocket('udp4');
            const remotehost = info.host;
            const remoteport = info.port;
            const socket_id = info.id;

            sock.bind({
                port: localport,
                address: ip
            });

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
        return this._ctx.udp_bind(exposePort, (info) => {
            try {
                return _on_new_flow(info);
            } catch (ex) {
                this._log(`failed to handle new flow: ${ex}`);
            }
        });
    }

    /// @brief permit inbound tcp stream on port
    /// @return a function to unmap the stream
    async permitInboundTCP(port) {
        this._log("permitInboundTCP");
        return new Promise((resolve, reject) => {
            var id;
            if (!this._hasExternal) {
                id = this._ctx.inbound_stream(port);
            }
            resolve(() => {
                if (id)
                    this._ctx.close_stream(id);
            });
        });
    }

    /// @brief returns true if an ip address is accessable via lokinet interface
    async ownsAddress(ip) {
        if (this._hasExternal)
            return ip === await this.localip();
        else
            return ip.startsWith("192.168.") || ip.startsWith("10.");
    }

    /// @brief accepts in a SDP data for an ice candidate from our local machine
    /// if the sdp is for a valid candidate it will do the rqeuire rewrite and return the new data
    /// otherwwise it will yield null
    async filterOwnSDP(sdp) {
        if (!sdp)
            return null;
        const lokiaddr = await this.localaddr();
        const addr = _extractAddrFromSDPData(sdp);
        const ip = addr[0];
        const port = addr[1];
        const allow = await this.ownsAddress(ip);
        const externPort = port;
        if (this._ctx) {
            // TODO: embedded mode needs additional rewrite
            // set up externPort here
            throw 'filtering SDP data without external lokinet is not implemented at this time';
        }
        return _rewriteSDPAddr(sdp, lokiaddr, externPort);
    }

    /// @brief take in another's SDP dat and do any rewrites needed before we use it
    /// if we dont want to use it we yield null otherwise we yield the new sdp data
    async acceptOtherSDP(sdp) {
        if (!sdp)
            return null;
        const addr = _extractAddrFromSDP(sdp);
        const lokiaddr = addr[0];
        const port = addr[1];

        if (this._hasExternal) {
            const addrs = await _reslver.resolve(lokiaddr);
            const ip = addrs[0];
            return _rewriteSDPAddr(sdp, ip, port);
        } else {
            // TODO: implement me
            throw 'accepting SDP data without external lokinet not implmented at this time';
        }
    }



};

class _Agent extends Agent {
    constructor(lokinet_ctx, options) {
        super(options);
        this._ctx = lokinet_ctx;
    }

    createConnection(options, callback) {
        const conn = this._ctx.connect(options.port || 80, options.host, () => {
            if (callback) callback(null, conn);
        });
        return conn;
    }
};

class _SecureAgent extends SecureAgent {
    constructor(lokinet_ctx, options) {
        super(options);
        this._ctx = lokinet_ctx;
    }

    createConnection(options, callback) {
        const conn = new TLSSocket(this._ctx.connect(options.port || 443, options.host, () => {
            if (callback) callback(null, conn);
        }));
        return conn;
    }
}

module.exports = {
    "Lokinet": Lokinet,
    "hex_to_base32z": hex_to_base32z,
    "set_log_level": set_log_level,
};