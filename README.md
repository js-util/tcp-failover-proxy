# tcp-failover-proxy

Setup a TCP proxy server, with automated failover - note this is not a loadbalancing proxy.

| Option         | Default | Description                                           |
|----------------|---------|-------------------------------------------------------|
| port           |         | (required) TCP Proxy Server port                      |
| host           |         | TCP Proxy Server host binding (use null for all)      |
| backend        |         | (required) List of backend `host:port` paths to route |
| log            | true    | Enable console logging of proxy server setup          |
| shuffle        | false   | Shuffle's the backend list, prior to using it         |
| connectTimeout | 2500    | Connection timeout in milliseconds                    |

# npm install

```.bash
npm install --save @js-util/tcp-failover-proxy
```

# Future TODO

- ability to change out backend listing on demand
- ability to run this in a seperate child process `.fork` thread, while maintaining existing interface.

# Example usage

> PS: This is incomplete code, you will need to modify for your actual use case.

```.js
// Load the module
const TCPFailoverProxy = require("@js-util/tcp-failover-proxy);

// Create the failover proxy, with the desired settings
const proxy = new TCPFailoverProxy({

    // port to run server on
    port: 3128,

    // host to run on, this can be configured for security reasons
    host: 127.0.0.1,

    // backend list, of host to route to
    backend: [ "192.168.10.10:3128", "192.168.10.11:3128" ],

    // enable console logging
    log: true,

    // Shuffle backend list, useful to help distribute traffic
    // over a large list of backend's
    shuffle: false,

    // Connection timeout for a backend to fail
    connectTimeout: 2500

}, (proxyServer) => {

    // Do something with setup callback if you like

});
```
