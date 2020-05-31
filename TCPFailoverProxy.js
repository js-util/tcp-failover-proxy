//----------------------------------------------
//
// Dependencies loading
//
//----------------------------------------------

const net  = require("net");

const twoWaySocketPipe = require("@js-util/two-way-socket-pipe");
const netSocketConnect = require("@js-util/net-socket-connect");

//----------------------------------------------
//
// Utility functions
//
//----------------------------------------------

/**
 * Return true, if port is within valid int range
 * 
 * @param {int} port 
 * @return {boolean} true if port is valid
 */
function isValidPort(port) {
	return port > 0 && port <= 65535;
}

/**
 * Given either a host/port string, or a {host,port} object.
 * Normalize it into its object representation used internally
 * 
 * Also setup the internal _fullString for logging usage
 * 
 * @param {*} backend 
 * 
 * @return {Object} host object
 */
function normalizeBackendHostObject(backend) {
	// Process the host string
	if( typeof backend == "string" || backend instanceof String ) {
		let split = backend.split(":");
		backend = {
			host: split[0],
			port: parseInt( split[1] )
		}
	}

	// Throw if its not an object
	if( typeof backend != "object" ) {
		throw `Unknown backend type: ${backend}`;
	} else {
		// Clone it (avoid modifying input)
		// and ensure host and port are string and int respectively
		backend = {
			host: (backend.host != null)? backend.host : "",
			port: parseInt(backend.port)
		}
	}

	// Normalize as a full string
	backend._fullString = backend.host + ":" + backend.port;

	// Alrighto time to check the host and port is valid format
	if( backend.host.length <= 0 ) {
		throw `Missing host string given for backend`
	}
	if( !isValidPort(backend.port) ) {
		throw `Invalid backend port setting: ${backend._fullString}`
	}

	// Return the backend object
	return backend;
}

/**
 * Given an array of backend settings, normalize them to the object format
 * see: `normalizeBackendHostObject`
 * 
 * @param {Array<*>} backend Arr
 * 
 * @return {Array<Object>} host objects in an array
 */
function normalizeBackendHostObjectArray(backendArr) {
	// Throw if null / empty
	if( backendArr == null || backendArr.length <= 0 ) {
		throw `Missing backend array configuration: ${backendArr}`
	}

	// Normalize as an array
	if( !Array.isArray(backendArr) ) {
		return normalizeBackendHostObjectArray( [backendArr] );
	}

	// Process the array
	let ret = [];
	for(let i=backendArr.length - 1; i>=0; --i) {
		ret[i] = normalizeBackendHostObject( backendArr[i] );
	}
	return ret;
}

/**
 * Scan the given a backend array, scan one by one for a valid connection.
 * 
 * @param {Array<*>} backendArr 
 * @param {function<socket,err>} callback 
 */
function scanAndConnectToValidBackend(backendArr, callback, connectTimeout = 5000, log = false) {
	// Callback to trigger, at most once
	function triggerCallback(socket, error) {
		if( callback ) {
			callback(socket, error);
		}
		callback = null;
	}

	// Backend scanning
	let scanPos  = 0;
	let scanList = backendArr.slice(0);

	// Recursive scanning function
	function recursiveScan() {
		// Throw if scan list is empty
		if( scanPos > scanList.length ) {
			triggerCallback(null, `Unable to connect to a valid backend - tried ${scanPos} times`);
			return;
		}

		// Get the backend
		let backend = scanList[ scanPos ];
		scanPos++;

		// Skip if backend is null
		if( backend == null ) {
			recursiveScan();
			return;
		}

		// Attempts the connection
		netSocketConnect( backend.port, backend.host, (socket,err) => {
			if( socket != null && err == null ) {
				// Valid connection, Tag the backend value
				socket._backend = backend;
				// return it
				triggerCallback(socket);
			} else {
				// recursively process the next backend
				if( log ) {
					console.warn(`# [Warning] unable to perform valid socket connection - ${err}`)
				}
				recursiveScan();
			}
		}, connectTimeout );
	}

	// Start it!
	recursiveScan();
}

//----------------------------------------------
//
// Class implementation
//
//----------------------------------------------

class TCPFailoverProxy {

	/**
	 * Setup a TCP failover proxy server with the provided options
	 * 
	 * | Option         | Default | Description                                           |
	 * |----------------|---------|-------------------------------------------------------|
	 * | port           |         | (required) TCP Proxy Server port                      |
	 * | host           |         | TCP Proxy Server host binding (use null for all)      |
	 * | backend        |         | (required) List of backend `host:port` paths to route |
	 * | log            | true    | Enable console logging of proxy server setup          |
	 * | shuffle        | false   | Shuffle's the backend list, prior to using it         |
	 * | connectTimeout | 2500    | Connection timeout in milliseconds                    |
	 * 
	 * @param {Object} opt see options table above
	 * @param {Function} callback to call after server setup is succesful, note failure triggers an exception instead
	 */
	constructor( opt, callback ) {
		// Self reference
		let self = this;

		// Process constructor options
		self._processOptObject(opt);

		// Lets log the setup
		if( self._log ) {
			console.log("#")
			console.log(`# Setting up proxy server (${self._host?self._host:""}:${self._port})`)
			console.log("#")
			console.log(`# With the following backends`)
			for(let i=0; i < self._backendList.length; i++) {
				console.log(`# - ${self._backendList[i]._fullString}`)
			}
			console.log("#")
			console.log("# And settings")
			console.log(`# - shuffle        = ${self._shuffle}`)
			console.log(`# - connectTimeout = ${self._connectTimeout}`)
			console.log("#")
			console.log("# Scanning for valid backend ... ")
		}

		// Shuffle host list on server boot if needed
		if( self._shuffle ) {
			self._backendList = require("@js-util/array-shuffle")(self._backendList);
		}

		// Scan for a valid backend route
		self._setupBackendRoute(() => {
			self._serverSetup(callback);
		});
	}
	
	/**
	 * Close any existing server. Note you should only call this once!
	 * 
	 * @param {Function} callback performed when server "close" is completed
	 */
	close() {
		if( this._server ) {
			this._server.close( callback );
			this._server = null;
		} else {
			if( callback ) {
				callback();
			}
		}
	}

	//------------------------------------------------
	//
	// options and server setup
	//
	//------------------------------------------------

	/**
	 * [private & internal only]
	 * 
	 * Given the option object, update the settings 
	 * (does not actually update the real server, just the internal config)
	 * 
	 * @param {Object} opt object to setup internally 
	 */
	_processOptObject( opt ) {
		// normalize the server port
		let port = opt.port;
		if(!isValidPort(port)) {
			throw `Invalid server port configured : ${port}`
		}

		// The server host, null means "any"
		let host = opt.host || null;

		// backend listing, and its shuffling options
		let backendList = normalizeBackendHostObjectArray( opt.backend );

		// Get the verbosity settings for console.log/warn
		let log = (opt.log === null || opt.log === undefined || opt.log)? true : false;

		// Get the routing mode
		let shuffle = (opt.shuffle)? true : false;

		// Get the connect timeout settings
		let connectTimeout = opt.connectTimeout || 2500;

		// Store the settings
		this._host            = host;
		this._port            = port;
		this._backendList     = backendList;
		this._log             = log;
		this._shuffle         = shuffle;
		this._connectTimeout  = connectTimeout;
	}

	/**
	 * [private & internal only]
	 * 
	 * After setting up the various options, 
	 * Kickstart the server and set it up
	 */
	_serverSetup( callback ) {
		// Self reference 
		let self = this;

		// Initialize the nodejs TCP server
		let server = net.createServer((inboundSocket) => {
			self._requestHandler(inboundSocket);
		});

		// Callback attachment handling
		if( callback ) {
			server.on('listening', () => { callback(self) });
		}

		// Open up the server host and port
		if( this._host ) {
			server.listen(this._port, this._host);
		} else {
			server.listen(this._port);
		}

		// Store the server object
		self._server = server;

		// Lets log the setup
		if( self._log ) {
			console.log(`# Starting proxy server at - ${self._host?self._host:""}:${self._port}`)
		}
	}

	//------------------------------------------------
	//
	// request handling and failover
	//
	//------------------------------------------------

	/**
	 * [private & internal only]
	 * 
	 * Handles an inbound TCP socket connection, and relays it
	 * 
	 * @param {socket} inboundSocket 
	 */
	_requestHandler( inboundSocket ) {
		// Self reference
		let self = this;

		// Scan for a valid socket backend
		scanAndConnectToValidBackend( this._backendList, function( remotesocket, err ) {

			// Valid socket
			if( remotesocket ) {
				// Rotate the backends (if needed)
				self._rotateBackendList( remotesocket._backend );

				// // Lets log the setup
				// if( self._log ) {
				// 	// to consider ??? - remove from log
				// 	let backend = remotesocket._backend;
				// 	console.log(`# Routing socker request for - ${backend.host}:${backend.port}`)
				// }

				// And bind the socket connection
				twoWaySocketPipe( inboundSocket, remotesocket );

				// And let the binded socket take over
				return;
			}

			// Assume an error occurs sadly
			if( self._log ) {
				console.warn(`# [Warning] No valid backend found : ${err}`)
			}
		}, this._connectTimeout, this._log );
	}

	/**
	 * Does the initial scaning of backend routes, for a valid connection
	 * (Priming the connection)
	 * 
	 * @param callback when initial backend route setup is completed
	 */
	_setupBackendRoute( callback ) {
		// Self reference
		let self = this;

		// Scan for a valid socket backend
		scanAndConnectToValidBackend( this._backendList, function( remotesocket, err ) {

			// Valid socket
			if( remotesocket ) {
				let backend = remotesocket._backend;

				// Rotate the backends (if needed)
				self._rotateBackendList( backend );

				// Lets log the setup
				if( self._log ) {
					// to consider ??? - remove from log
					console.log(`# Configured prefered backend as - ${backend.host}:${backend.port}`)
				}
			} else {
				// No socket found
				// Assume an error occurs sadly
				if( self._log ) {
					console.warn(`# [Warning] Unable to configure default backend, no valid backend found : ${err}`)
				}
			}

			// Finish by calling the callback
			if( callback ) {
				callback();
			}
		}, this._connectTimeout, this._log );
	}

	/**
	 * [private & internal only]
	 * 
	 * Rotate the backend list, to priotise the target host
	 * @param {Object} targetHost 
	 */
	_rotateBackendList( targetHost ) {
		// Check if the host is in the list
		let targetIdx = this._backendList.indexOf(targetHost);

		// Skip, if the idx is not in the list
		// or its the first element
		if( targetIdx <= 0 ) {
			return;
		}

		// Lets log the setup
		if( this._log ) {
			console.warn(`# [Warning] Switching prefered backend to (${targetHost.host}:${targetHost.port})`)
		}

		// Time to slice and shuffle
		let failedArr = this._backendList.slice( 0, targetIdx );
		let targetArr = this._backendList.slice( targetIdx );
		// and save
		this._backendList = targetArr.concat( failedArr );
	}

}

// Class export
module.exports = TCPFailoverProxy;
