/*
import { Lokinet } from './liblokinet.js';
import fetch from 'node-fetch';
import { get } from 'http';
*/
const liblokinet = require('./index.js');
const Lokinet = liblokinet.Lokinet;
const get = require('http').get;

// make log shut up
liblokinet.set_log_level("none");

const runit = async (opts) => {
    console.log("starting up lokinet...");
    let ctx = new Lokinet(opts);

    await ctx.start();
    const host = await ctx.hostname();
    console.log(`we are ${host}`);

    // make an http agent
    const agent = ctx.httpAgent();

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

//runit();
runit({
    alwaysEmbed: true
});