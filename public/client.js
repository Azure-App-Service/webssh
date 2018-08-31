var siteStatus = "RUNNING";
var waRestart = false;
var refreshTimer = false;

/**
 * Uses AJAX to check the availability(success response code) of a service/url.
 * Refreshes the current page if the service returns a HTTP success code.
 * @param {string} path : the url whose availability needs to be checked.
 * @param {number} frequency : the time period after which polling request is made.
 * @param {boolean} isPollingRequest:  if true,keeps polling the {path} till a success
 *                                     response is received and refreshes the page
 *                                     if false, sends a single GET request to the path
 */
var checkAvailability = function (path, frequency, isPollingRequest) {
    $.ajax({
        url: path,
        type: 'GET',
        success: function (response) {
            console.log("Site Available");
            if (isPollingRequest) {
                location.reload(true);
            }
        },
        error: function (request, error) {
            if (isPollingRequest) {
                setTimeout(function () {
                    checkAvailability(path, frequency, isPollingRequest);
                }, frequency);
                console.log("Polling " + path);
            }
        }
    });
}


//To handle the case where WebApp container has not Cold Started when Kudu is called
checkAvailability('https://' + window.location.hostname.replace('.scm', ''), 100000, false);

var terminalContainer = document.getElementById('terminal-container'),
    term = new Terminal({
        cursorBlink: true
    }),
    socket,
    termid;

term.open(terminalContainer);

term.fit();

var cols = term.cols,
    rows = term.rows;

if (document.location.pathname) {
    var parts = document.location.pathname.split('/'),
        base = parts.slice(0, parts.length - 1).join('/') + '/',
        resource = base.substring(1) + 'socket.io';
    socket = io.connect(null, {
        resource: resource
    });
} else {
    socket = io.connect();
}

var credentialReplay = document.getElementById('credentials')
credentialReplay.onclick = replayCredentials;

function replayCredentials() {
    socket.emit('control', 'replayCredentials');
    //term.writeln('sending credentials');
    return true;
}

socket.emit('create', term.cols, term.rows, function (err, data) {
    if (err) return self._destroy();
    self.pty = data.pty;
    self.id = data.id;
    termid = self.id;
    term.emit('open tab', self);
});


/**
 * Handles the WebSSH status change by interpreting the message sent over
 * the socket connection. This status can be : StartingLSite, StartedLSite
 * or LSiteNotStarted indicating starting WebApp container, started WebApp container
 * but performing health check, WebApp containers not running respectively
 * @param {string} newStatusReq contains a key 'message' which describes the new status
 */
var processWebSSHStatusChangeRequest = function (newStatusReq) {
    console.log("Status change request : " + newStatusReq);
    var retCode = new String(newStatusReq['message']);
    retCode = retCode.replace(/(\r\n\t|\n|\r\t)/gm, "");
    console.log(retCode);
    siteStatus = retCode;
    if (retCode === 'StartingLSite') {
        document.getElementById('status').style.backgroundColor = 'orange';
        document.getElementById('status').innerHTML = 'WAITING FOR NEW CONTAINER(S) TO START';
    } else if (retCode === 'StartedLSite') {
        document.getElementById('status').style.backgroundColor = 'orange';
        document.getElementById('status').innerHTML = 'CONTAINER(S) STARTED. WAITING FOR ALL SERVICES TO START';
        if (waRestart) {
            checkAvailability('client.js', 2000, true);
        } else {
            setTimeout(function () {
                checkAvailability('client.js', 2000, true);
            }, 20000);
        }
    } else if (retCode === 'LSiteNotStarted') {
        document.getElementById('status').style.backgroundColor = 'blue';
        document.getElementById('status').innerHTML = 'WAITING FOR WEBAPP TO COLD START';
        checkAvailability('https://' + window.location.hostname.replace('.scm', ''), 100000, false);
        waRestart = true;
    } else {
        document.getElementById('status').style.backgroundColor = 'red';
        document.getElementById('status').innerHTML = 'WEBSOCKET SERVER DISCONNECTED. PLEASE REFRESH THE PAGE';
    }
}

/** Handles the page refresh/status display when WebSSH socket connection is disconnected*/
var handleConnectionDisconnect = function () {
    if (siteStatus === 'StartedLSite') {
        if (!refreshTimer) {
            console.log("Checking availability for client.js");
            checkAvailability('client.js', 2000, true);
            refreshTimer = true;
        }
    }
    if (!refreshTimer && (siteStatus === "RUNNING")) {
        document.getElementById('status').style.backgroundColor = 'red';
        document.getElementById('status').innerHTML = 'SSH CONNECTION DISCONNECTED. ATTEMPTING TO RECONNECT';
        refreshTimer = true;
        setTimeout(function () {
            checkAvailability('https://' + window.location.hostname.replace('.scm', ''), 100000, false);
        }, 6000);
        checkAvailability('client.js', 2000, true);
    }
}

socket.on('connect', function () {
    document.getElementById('status').style.backgroundColor = 'green';
    document.getElementById('status').innerHTML = 'CONNECTION ESTABLISHED';
    term.on('data', function (data) {
        socket.emit('data', data);
    });
    socket.on('title', function (data) {
        document.title = data;
    }).on('status', function (data) {
        document.getElementById('status').innerHTML = data;
    }).on('headerBackground', function (data) {
        document.getElementById('header').style.backgroundColor = data;
    }).on('header', function (data) {
        document.getElementById('header').innerHTML = data;
    }).on('footer', function (data) {
        document.getElementById('footer').innerHTML = data;
    }).on('statusBackground', function (data) {
        document.getElementById('status').style.backgroundColor = data;
    }).on('server', function (data) {
        console.log("got a message from the server");
        processWebSSHStatusChangeRequest(data);
    }).on('allowreplay', function (data) {
        console.log('allowreplay: ' + data);
        if (data == 'true') {
            document.getElementById('credentials').style.display = 'inline';
            console.log('display: block');
        } else {
            document.getElementById('credentials').style.display = 'none';
            console.log('display: none');
        }
    }).on('data', function (data) {
        term.write(data);
    }).on('disconnect', function () {
        console.log("Socket connection Disconnected");
        console.log(siteStatus);
        handleConnectionDisconnect();
        socket.io.reconnection(false);
    }).on('close', function () {
        console.log("Switching on close refresher");
        if (!refreshTimer) {
            checkAvailability('client.js', 2000, true);
            refreshTimer = true;
        }
    }).on('error', function (err) {
        if (siteStatus === "RUNNING") {
            document.getElementById('status').style.backgroundColor = 'red';
            document.getElementById('status').innerHTML = 'ERROR ' + err;
        }
    });
});
