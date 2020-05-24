#!/usr/bin/env node

//
// Demo command line implementation
//

var net = require("net");
const TCPFailoverProxy = require("./TCPFailoverProxy");

if (process.argv.length < 4) {
	console.log("usage: %s <localport> <remotehost:port> ... ", process.argv[1]);
	process.exit();
}

process.on("uncaughtException", function(error) {
	console.error("# [UncaughtException] - ", error);
});

let localport   = process.argv[2];
let backendList = process.argv.slice(3);

let proxy = new TCPFailoverProxy( {
    port: localport,
    backend: backendList
} );
