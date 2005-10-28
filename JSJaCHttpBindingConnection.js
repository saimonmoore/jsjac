var JSJaCHBC_MAX_HOLD = 1;
var JSJACHBC_MAX_WAIT = 300; 

function JSJaCHttpBindingConnection(oArg) {
	this.base = JSJaCConnection;
	this.base(oArg);

	this._hold = JSJaCHBC_MAX_HOLD;
	this._inactivity = 0;
	this._min_polling = 0;
	this._wait = JSJACHBC_MAX_WAIT;  

	this.connect = JSJaCHBCConnect;
	this.disconnect = JSJaCHBCDisconnect;
	this.isPolling = function() { return (this._hold == 0) }; 
	this.setPollInterval = function(timerval) {
		if (!timerval || isNaN(timerval)) {
			this.oDbg.log("Invalid timerval: " + timerval,1);
			return -1;
		}
// 		if (!this.isPolling()) {
// 			this._timerval = 1;
// 			return -1;
// 		}
		if (this._min_polling && timerval < this._min_polling*1000)
			this._timerval = this._min_polling*1000;
		else if (this._inactivity && timerval > this._inactivity*1000)
			this._timerval = this._inactivity*1000;
		else
			this._timerval = timerval;
		return this._timerval;
	};

	this._getRequestString = JSJaCHBCGetRequestString;
	this._getStreamID = JSJaCHBCGetStreamID;
	this._prepareResponse = JSJaCHBCPrepareResponse;
	this._setHold = function(hold)  {
		if (!hold || isNaN(hold) || hold < 0)
			hold = 0;
		else if (hold > JSJaCHBC_MAX_HOLD)
			hold = JSJaCHBC_MAX_HOLD;
		this._hold = hold;
		return this._hold;
	};
	this._setupRequest = JSJaCHBCSetupRequest;
	
	this._getFreeSlot = function() {
		for (var i=0; i<this._hold+1; i++)
			if (typeof(this._req[i]) == 'undefined' || this._req[i].readyState == 4)
				return i;
		return -1; // nothing found
	}
}

function JSJaCHBCSetupRequest(async) {
	var req = XmlHttp.create();
	try {
		req.open("POST",this._httpbase,async);
		req.setRequestHeader('Content-Type','text/xml; charset=utf-8');
	} catch(e) { this.oDbg.log(e,1); }
	return req;
}

function JSJaCHBCGetRequestString(xml) {
	this._rid++;
		
	var reqstr = "<body rid='"+this._rid+"' sid='"+this._sid+"' xmlns='http://jabber.org/protocol/httpbind' ";
	if (JSJaC_HAVEKEYS) {
		reqstr += "key='"+this._keys.getKey()+"' ";
		if (this._keys.lastKey()) {
			this._keys = new JSJaCKeys(hex_sha1,this.oDbg);
			reqstr += "newkey='"+this._keys.getKey()+"' ";
		}
	}
	if (xml) {
		reqstr += ">" + xml + "</body>";
	} else {
		reqstr += "/>"; 
	}
	 
	return reqstr;
}

function JSJaCHBCPrepareResponse(req) {
	if (!this.connected())
		return null;

	if (typeof(req) == 'undefined' || !req)
		return null;

	/* handle error */
	
	if (req.status != 200) {
		this.oDbg.log("invalid response ("+req.status+"):\n" + req.getAllResponseHeaders()+"\n"+req.responseText,1);
		clearTimeout(this._timeout); // remove timer
		if (!this.isPolling())
			clearInterval(this._interval);
		this._connected = false;
		this.oDbg.log("Disconnected.",1);
		this.handleEvent('ondisconnect');
		if (req.status < 500)
			this.handleEvent('onerror',JSJaCError('500','cancel','service-unavailable'));
		else
			this.handleEvent('onerror',JSJaCError('503','cancel','service-unavailable'));
		return null;
	} 

	if (!req.responseXML)
		return null;

	// Check for errors from the server
	var body = req.responseXML.firstChild;
	if (body.getAttribute("type") == "terminate") {
		this.oDbg.log("invalid response:\n" + req.responseText,1);
		clearTimeout(this._timeout); // remove timer
		this._connected = false;
		this.oDbg.log("Disconnected.",1);
		this.handleEvent('ondisconnect');
		this.handleEvent('onerror',JSJaCError('500','cancel','service-unavailable'));
		return null;
	}

	return req.responseXML;
}

function JSJaCHBCConnect(oArg) {
	// initial request to get sid and streamid

	this.domain = oArg.domain || 'localhost';
	this.username = oArg.username;
	this.resource = oArg.resource;
	this.pass = oArg.pass;
	this.register = oArg.register;
	this.oDbg.log("httpbase: " + this._httpbase + "\domain:" + this.domain,2);
	this.host = oArg.host || this.domain;
	this.port = oArg.port || 5222;
	if (oArg.secure) {
		this.secure = 'true';
		if (!oArg.port)
			this.port = 5223;
	} else 
		this.secure = 'false';

	this._rid  = Math.round( 100000.5 + ( ( (900000.49999) - (100000.5) ) * Math.random() ) );

	var reqstr = "<body hold='"+this._hold+"' xmlns='http://jabber.org/protocol/httpbind' to='"+this.domain+"' wait='"+this._wait+"' rid='"+this._rid+"'";
	if (oArg.host || oArg.port)
		reqstr += " route='xmpp:"+this.host+":"+this.port+"'";
	if (oArg.secure)
		reqstr += " secure='"+this.secure+"'";
	if (JSJaC_HAVEKEYS) {
		this._keys = new JSJaCKeys(hex_sha1,this.oDbg); // generate first set of keys
		key = this._keys.getKey();
		reqstr += " newkey='"+key+"'";
	}
	reqstr += "/>";

	var slot = this._getFreeSlot();
	this._req[slot] = this._setupRequest(false);
	this.oDbg.log(reqstr,4);
	this._req[slot].send(reqstr);

	this.oDbg.log(this._req[slot].getAllResponseHeaders(),4);
	this.oDbg.log(this._req[slot].responseText,4);

	if (!this._req[slot].responseXML) {
		this.oDbg.log("initial response broken",1);
		this.handleEvent('onerror',JSJaCError('500','cancel','service-unavailable'));
		return;
	}
	var body = this._req[slot].responseXML.getElementsByTagName("body").item(0);
	if (!body || body.getAttribute("xmlns") != "http://jabber.org/protocol/httpbind") {
		this.oDbg.log("no body element or incorrect body in initial response",1);
		this.handleEvent("onerror",JSJaCError("500","cancel","service-unavailable"));
		return;
	}								 

	// get session ID
	this._sid = body.getAttribute('sid');
	this.oDbg.log("got sid: "+this._sid,2);

	// get attributes from response body
	if (body.getAttribute('polling'))
		this._min_polling = body.getAttribute('polling');

	if (body.getAttribute('inactivity'))
		this._inactivity = body.getAttribute('inactivity');
	
	if (body.getAttribute('requests'))
		var hold = this._setHold(body.getAttribute('requests')-1);
	this.oDbg.log("set hold to " + hold,2);

	// must be done after response attributes have been collected
	this.setPollInterval(this._timerval);

	/* start sending from queue for not polling connections */
	this._connected = true;

	oCon = this;
	this._interval= setInterval("oCon._checkQueue()",1);

	/* wait for initial stream response to extract streamid needed
	 * for digest auth
	 */
	this._getStreamID(slot);
}

function JSJaCHBCGetStreamID(slot) {

	this.oDbg.log(this._req[slot].responseText,4);

	if (!this._req[slot].responseXML || !this._req[slot].responseXML.firstChild) {
		this.handleEvent('onerror',JSJaCError('500','cancel','service-unavailable'));
		return;
	}
	var body = this._req[slot].responseXML.firstChild;

	// extract stream id used for non-SASL authentication
	if (body.getAttribute('authid')) {
		this.streamid = body.getAttribute('authid');
		this.oDbg.log("got streamid: "+this.streamid,2);
	} else {
		oCon = this;
		this._timeout = setTimeout("oCon._sendEmpty()",this.getPollInterval());
		return;
	}
	
	if (this.register)
		this._doReg();
	else
		this._doAuth();

	this._timeout = setTimeout("oCon._process()",this.getPollInterval());
}

function JSJaCHBCDisconnect() {
	
	if (!this.connected())
		return;

	// make sure queue is empty
	this._checkQueue();

	if (!this.isPolling())
		clearInterval(this._interval);

	if (this._timeout)
		clearTimeout(this._timeout); // remove timer

	this._rid++;
	
	var xmlhttp = this._setupRequest(false);

	var reqstr = "<body type='terminate' xmlns='http://jabber.org/protocol/httpbind' sid='"+this._sid+"' rid='"+this._rid+"'";
	if (JSJaC_HAVEKEYS) {
		reqstr += " key='"+this._keys.getKey()+"'";
	}
	reqstr += "><presence type='unavailable' xmlns='jabber:client'/></body>"
	xmlhttp.send(reqstr);

	this.oDbg.log("Disconnected: "+xmlhttp.responseText,2);
	this._connected = false;
	this.handleEvent('ondisconnect');
}
