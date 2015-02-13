/* QuickBlox JavaScript SDK - v1.8.1 - 2015-02-13 */

!function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define([],e);else{var f;"undefined"!=typeof window?f=window:"undefined"!=typeof global?f=global:"undefined"!=typeof self&&(f=self),f.QB=e()}}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/*
 * QuickBlox JavaScript SDK
 *
 * Authentication Module
 *
 */

var config = require('../qbConfig'),
    Utils = require('../qbUtils'),
    CryptoJS = require('crypto-js/hmac-sha1');

function AuthProxy(service) {
  this.service = service;
}

AuthProxy.prototype = {

  getSession: function(callback) {
    if (config.debug) { console.log('AuthProxy.getSession');}
    this.service.ajax({url: Utils.getUrl(config.urls.session)}, function(err,res){
      if (err){ callback(err, null); }
      else { callback (err, res); }
    });
  },

  createSession: function(params, callback) {

    if (config.creds.appId === '' ||
        config.creds.authKey === '' ||
        config.creds.authSecret === '') {
      throw new Error('Cannot create a new session without app credentials (app ID, auth key and auth secret)');
    }

    var _this = this, message;

    if (typeof params === 'function' && typeof callback === 'undefined') {
      callback = params;
      params = {};
    }

    // Signature of message with SHA-1 using secret key
    message = generateAuthMsg(params);
    message.signature = signMessage(message, config.creds.authSecret);
    
    if (config.debug) { console.log('AuthProxy.createSession', message); }
    this.service.ajax({url: Utils.getUrl(config.urls.session), type: 'POST', data: message},
                      function(err, res) {
                        if (err) {
                          callback(err, null);
                        } else {
                          _this.service.setSession(res.session);
                          callback(null, res.session);
                        }
                      });
  },

  destroySession: function(callback) {
    var _this = this;
    if (config.debug) { console.log('AuthProxy.destroySession'); }
    this.service.ajax({url: Utils.getUrl(config.urls.session), type: 'DELETE', dataType: 'text'},
                      function(err, res) {
                        if (err) {
                          callback(err, null);
                        } else {
                          _this.service.setSession(null);
                          callback(null, res);
                        }
                      });
  },

  login: function(params, callback) {
    if (config.debug) { console.log('AuthProxy.login', params); }
    this.service.ajax({url: Utils.getUrl(config.urls.login), type: 'POST', data: params},
                      function(err, res) {
                        if (err) { callback(err, null); }
                        else { callback(null, res.user); }
                      });
  },

  logout: function(callback) {
    if (config.debug) { console.log('AuthProxy.logout'); }
    this.service.ajax({url: Utils.getUrl(config.urls.login), type: 'DELETE', dataType:'text'}, callback);
  }
  
};

module.exports = AuthProxy;

/* Private
---------------------------------------------------------------------- */
function generateAuthMsg(params) {
  var message = {
    application_id: config.creds.appId,
    auth_key: config.creds.authKey,
    nonce: Utils.randomNonce(),
    timestamp: Utils.unixTime()
  };
  
  // With user authorization
  if (params.login && params.password) {
    message.user = {login: params.login, password: params.password};
  } else if (params.email && params.password) {
    message.user = {email: params.email, password: params.password};
  } else if (params.provider) {
    // Via social networking provider (e.g. facebook, twitter etc.)
    message.provider = params.provider;
    if (params.scope) {
      message.scope = params.scope;
    }
    if (params.keys && params.keys.token) {
      message.keys = {token: params.keys.token};
    }
    if (params.keys && params.keys.secret) {
      messages.keys.secret = params.keys.secret;
    }
  }
  
  return message;
}

function signMessage(message, secret) {
  var sessionMsg = Object.keys(message).map(function(val) {
    if (typeof message[val] === 'object') {
      return Object.keys(message[val]).map(function(val1) {
        return val + '[' + val1 + ']=' + message[val][val1];
      }).sort().join('&');
    } else {
      return val + '=' + message[val];
    }
  }).sort().join('&');
  
  return CryptoJS(sessionMsg, secret).toString();
}

},{"../qbConfig":9,"../qbUtils":13,"crypto-js/hmac-sha1":17}],2:[function(require,module,exports){
/*
 * QuickBlox JavaScript SDK
 *
 * Chat 2.0 Module
 *
 */

/*
 * User's callbacks (listener-functions):
 * - onMessageListener
 * - onContactListListener
 * - onSubscribeListener
 * - onConfirmSubscribeListener
 * - onRejectSubscribeListener
 * - onDisconnectingListener
 * - onReconnectListener
 */

var config = require('../qbConfig'),
    Utils = require('../qbUtils');

var isBrowser = typeof window !== "undefined";
var unsupported = "This function isn't supported outside of the browser (...yet)";

if (isBrowser) {
  require('../../lib/strophe/strophe.min');
  // add extra namespaces for Strophe
  Strophe.addNamespace('CARBONS', 'urn:xmpp:carbons:2');
}
 
var dialogUrl = config.urls.chat + '/Dialog';
var messageUrl = config.urls.chat + '/Message';

var connection,
    webrtc,
    roster = {},
    joinedRooms = {};

function ChatProxy(service, webrtcModule, conn) {
  var self = this;
  webrtc = webrtcModule;
  connection = conn;

  this.service = service;
  if(isBrowser) {
    this.roster = new RosterProxy(service);
    this.muc = new MucProxy(service);
  }
  this.dialog = new DialogProxy(service);
  this.message = new MessageProxy(service);
  this.helpers = new Helpers;

  // reconnect to chat if it wasn't the logout method
  this._isLogout = false;

  // stanza callbacks (Message, Presence, IQ)

  this._onMessage = function(stanza) {
    var from = stanza.getAttribute('from'),
        to = stanza.getAttribute('to'),
        type = stanza.getAttribute('type'),
        body = stanza.querySelector('body'),
        invite = stanza.querySelector('invite'),
        extraParams = stanza.querySelector('extraParams'),
        delay = stanza.querySelector('delay'),
        messageId = stanza.getAttribute('id'),
        dialogId = type === 'groupchat' ? self.helpers.getDialogIdFromNode(from) : null,
        userId = type === 'groupchat' ? self.helpers.getIdFromResource(from) : self.helpers.getIdFromNode(from),        
        message, extension, attachments, attach, attributes;

    if (invite) return true;

    // custom parameters
    // TODO: need rewrite this block
    if (extraParams) {
      extension = {};
      attachments = [];
      for (var i = 0, len = extraParams.childNodes.length; i < len; i++) {
        if (extraParams.childNodes[i].tagName === 'attachment') {
          
          // attachments
          attach = {};
          attributes = extraParams.childNodes[i].attributes;
          for (var j = 0, len2 = attributes.length; j < len2; j++) {
            if (attributes[j].name === 'id' || attributes[j].name === 'size')
              attach[attributes[j].name] = parseInt(attributes[j].value);
            else
              attach[attributes[j].name] = attributes[j].value;
          }
          attachments.push(attach);

        } else {
          if (extraParams.childNodes[i].childNodes.length > 1) {

            extension = self._XMLtoJS(extension, extraParams.childNodes[i].tagName, extraParams.childNodes[i]);

          } else {

            extension[extraParams.childNodes[i].tagName] = extraParams.childNodes[i].textContent;

          }
        }
      }

      if (attachments.length > 0)
        extension.attachments = attachments;
    }

    message = {
      id: messageId,
      dialog_id: dialogId,
      type: type,
      body: (body && body.textContent) || null,
      extension: extension || null
    };

    // !delay - this needed to don't duplicate messages from chat 2.0 API history
    // with typical XMPP behavior of history messages in group chat
    if (typeof self.onMessageListener === 'function' && (type === 'chat' || !delay))
      self.onMessageListener(userId, message, to, delay);

    // we must return true to keep the handler alive
    // returning false would remove it after it finishes
    return true;
  };

  this._onPresence = function(stanza) {
    var from = stanza.getAttribute('from'),
        type = stanza.getAttribute('type'),
        userId = self.helpers.getIdFromNode(from);

    if (!type) {
      if (typeof self.onContactListListener === 'function' && roster[userId] && roster[userId].subscription !== 'none')
        self.onContactListListener(userId);
    } else {

      // subscriptions callbacks
      switch (type) {
      case 'subscribe':
        if (roster[userId] && roster[userId].subscription === 'to') {
          roster[userId] = {
            subscription: 'both',
            ask: null
          };
          self.roster._sendSubscriptionPresence({
            jid: from,
            type: 'subscribed'
          });
        } else {
          if (typeof self.onSubscribeListener === 'function')
            self.onSubscribeListener(userId);
        }
        break;
      case 'subscribed':
        if (roster[userId] && roster[userId].subscription === 'from') {
          roster[userId] = {
            subscription: 'both',
            ask: null
          };          
        } else {
          roster[userId] = {
            subscription: 'to',
            ask: null
          };
          if (typeof self.onConfirmSubscribeListener === 'function')
            self.onConfirmSubscribeListener(userId);
        }
        break;
      case 'unsubscribed':
        roster[userId] = {
          subscription: 'none',
          ask: null
        };
        if (typeof self.onRejectSubscribeListener === 'function')
          self.onRejectSubscribeListener(userId);
        break;
      case 'unsubscribe':
        roster[userId] = {
          subscription: 'to',
          ask: null
        };
        // if (typeof self.onRejectSubscribeListener === 'function')
        //   self.onRejectSubscribeListener(userId);
        break;
      case 'unavailable':
        if (typeof self.onContactListListener === 'function' && roster[userId] && roster[userId].subscription !== 'none')
          self.onContactListListener(userId, type);
        break;
      }

    }

    // we must return true to keep the handler alive
    // returning false would remove it after it finishes
    return true;
  };

  this._onIQ = function(stanza) {

    // we must return true to keep the handler alive
    // returning false would remove it after it finishes
    return true;
  };
}

/* Chat module: Core
---------------------------------------------------------------------- */
ChatProxy.prototype = {

  connect: function(params, callback) {
    if(!isBrowser) throw unsupported;

    if (config.debug) { console.log('ChatProxy.connect', params); }
    var self = this,
        err, rooms;

    connection.connect(params.jid, params.password, function(status) {
      switch (status) {
      case Strophe.Status.ERROR:
        err = getError(422, 'Status.ERROR - An error has occurred');
        if (typeof callback === 'function') callback(err, null);
        break;
      case Strophe.Status.CONNECTING:
        trace('Status.CONNECTING');
        trace('Chat Protocol - ' + (config.chatProtocol.active === 1 ? 'BOSH' : 'WebSocket'));
        break;
      case Strophe.Status.CONNFAIL:
        err = getError(422, 'Status.CONNFAIL - The connection attempt failed');
        if (typeof callback === 'function') callback(err, null);
        break;
      case Strophe.Status.AUTHENTICATING:
        trace('Status.AUTHENTICATING');
        break;
      case Strophe.Status.AUTHFAIL:
        err = getError(401, 'Status.AUTHFAIL - The authentication attempt failed');
        if (typeof callback === 'function') callback(err, null);
        break;
      case Strophe.Status.CONNECTED:
        trace('Status.CONNECTED at ' + getLocalTime());

        connection.addHandler(self._onMessage, null, 'message', 'chat');
        connection.addHandler(self._onMessage, null, 'message', 'groupchat');
        connection.addHandler(self._onPresence, null, 'presence');
        connection.addHandler(self._onIQ, null, 'iq');

        // set signaling callbacks
        connection.addHandler(webrtc._onMessage, null, 'message', 'headline');

        // enable carbons
        self._enableCarbons(function() {
          // get the roster
          self.roster.get(function(contacts) {
            roster = contacts;

            // chat server will close your connection if you are not active in chat during one minute
            // initial presence and an automatic reminder of it each 55 seconds
            connection.send($pres().tree());
            connection.addTimedHandler(55 * 1000, self._autoSendPresence);

            if (typeof callback === 'function') {
              callback(null, roster);
            } else {
              self._isLogout = false;

              // recover the joined rooms
              rooms = Object.keys(joinedRooms);
              for (var i = 0, len = rooms.length; i < len; i++) {
                self.muc.join(rooms[i]);
              }

              if (typeof self.onReconnectListener === 'function')
                self.onReconnectListener();
            }
          });
        });

        break;
      case Strophe.Status.DISCONNECTING:
        trace('Status.DISCONNECTING');
        break;
      case Strophe.Status.DISCONNECTED:
        trace('Status.DISCONNECTED at ' + getLocalTime());
        connection.reset();

        if (typeof self.onDisconnectingListener === 'function')
          self.onDisconnectingListener();

        // reconnect to chat
        if (!self._isLogout) self.connect(params);
        break;
      case Strophe.Status.ATTACHED:
        trace('Status.ATTACHED');
        break;
      }
    });
  },

  send: function(jid, message) {
    if(!isBrowser) throw unsupported;

    var self = this,
        msg = $msg({
          from: connection.jid,
          to: jid,
          type: message.type,
          id: message.id || Utils.getBsonObjectId()
        });
    
    if (message.body) {
      msg.c('body', {
        xmlns: Strophe.NS.CLIENT
      }).t(message.body).up();
    }
    
    // custom parameters
    if (message.extension) {
      msg.c('extraParams', {
        xmlns: Strophe.NS.CLIENT
      });
      
      Object.keys(message.extension).forEach(function(field) {
        if (field === 'attachments') {

          // attachments
          message.extension[field].forEach(function(attach) {
            msg.c('attachment', attach).up();
          });

        } else if (typeof message.extension[field] === 'object') {

          self._JStoXML(field, message.extension[field], msg);

        } else {
          msg.c(field).t(message.extension[field]).up();
        }
      });
    }
    
    connection.send(msg);
  },

  // helper function for ChatProxy.send()
  sendPres: function(type) {
    if(!isBrowser) throw unsupported;

    connection.send($pres({ 
      from: connection.jid,
      type: type
    }));
  },

  disconnect: function() {
    if(!isBrowser) throw unsupported;

    joinedRooms = {};
    this._isLogout = true;
    connection.flush();
    connection.disconnect();
  },

  addListener: function(params, callback) {
    if(!isBrowser) throw unsupported;

    return connection.addHandler(handler, null, params.name || null, params.type || null, params.id || null, params.from || null);

    function handler() {
      callback();
      // if 'false' - a handler will be performed only once
      return params.live !== false;
    }
  },

  deleteListener: function(ref) {
    if(!isBrowser) throw unsupported;

    connection.deleteHandler(ref);
  },

  // TODO: the magic
  _JStoXML: function(title, obj, msg) {
    var self = this;
    msg.c(title);
    Object.keys(obj).forEach(function(field) {
      if (typeof obj[field] === 'object')
        self._JStoXML(field, obj[field], msg);
      else
        msg.c(field).t(obj[field]).up();
    });
    msg.up();
  },

  // TODO: the magic
  _XMLtoJS: function(extension, title, obj) {
    var self = this;
    extension[title] = {};
    for (var i = 0, len = obj.childNodes.length; i < len; i++) {
      if (obj.childNodes[i].childNodes.length > 1) {
        extension[title] = self._XMLtoJS(extension[title], obj.childNodes[i].tagName, obj.childNodes[i]);
      } else {
        extension[title][obj.childNodes[i].tagName] = obj.childNodes[i].textContent;
      }
    }
    return extension;
  },

  _autoSendPresence: function() {
    if(!isBrowser) throw unsupported;

    connection.send($pres().tree());
    // we must return true to keep the handler alive
    // returning false would remove it after it finishes
    return true;
  },

  // Carbons XEP [http://xmpp.org/extensions/xep-0280.html]
  _enableCarbons: function(callback) {
    if(!isBrowser) throw unsupported;

    var iq;

    iq = $iq({
      from: connection.jid,
      type: 'set',
      id: connection.getUniqueId('enableCarbons')
    }).c('enable', {
      xmlns: Strophe.NS.CARBONS
    });

    connection.sendIQ(iq, function(stanza) {
      callback();
    });
  }

};

/* Chat module: Roster
 *
 * Integration of Roster Items and Presence Subscriptions
 * http://xmpp.org/rfcs/rfc3921.html#int
 * default - Mutual Subscription
 *
---------------------------------------------------------------------- */
function RosterProxy(service) {
  this.service = service;
  this.helpers = new Helpers;
}

RosterProxy.prototype = {

  get: function(callback) {
    var iq, self = this,
        items, userId, contacts = {};

    iq = $iq({
      from: connection.jid,
      type: 'get',
      id: connection.getUniqueId('getRoster')
    }).c('query', {
      xmlns: Strophe.NS.ROSTER
    });

    connection.sendIQ(iq, function(stanza) {
      items = stanza.getElementsByTagName('item');
      for (var i = 0, len = items.length; i < len; i++) {
        userId = self.helpers.getIdFromNode(items[i].getAttribute('jid')).toString();
        contacts[userId] = {
          subscription: items[i].getAttribute('subscription'),
          ask: items[i].getAttribute('ask') || null
        };
      }
      callback(contacts);
    });
  },

  add: function(jid, callback) {
    var self = this,
        userId = self.helpers.getIdFromNode(jid).toString();

    roster[userId] = {
      subscription: 'none',
      ask: 'subscribe'
    };

    self._sendSubscriptionPresence({
      jid: jid,
      type: 'subscribe'
    });

    if (typeof callback === 'function') callback();
  },

  confirm: function(jid, callback) {
    var self = this,
        userId = self.helpers.getIdFromNode(jid).toString();

    roster[userId] = {
      subscription: 'from',
      ask: 'subscribe'
    };

    self._sendSubscriptionPresence({
      jid: jid,
      type: 'subscribed'
    });

    self._sendSubscriptionPresence({
      jid: jid,
      type: 'subscribe'
    });

    if (typeof callback === 'function') callback();
  },

  reject: function(jid, callback) {
    var self = this,
        userId = self.helpers.getIdFromNode(jid).toString();

    roster[userId] = {
      subscription: 'none',
      ask: null
    };

    self._sendSubscriptionPresence({
      jid: jid,
      type: 'unsubscribed'
    });

    if (typeof callback === 'function') callback();
  },

  remove: function(jid, callback) {
    var iq, userId, self = this;

    iq = $iq({
      from: connection.jid,
      type: 'set',
      id: connection.getUniqueId('removeRosterItem')
    }).c('query', {
      xmlns: Strophe.NS.ROSTER
    }).c('item', {
      jid: jid,
      subscription: 'remove'
    });

    userId = self.helpers.getIdFromNode(jid).toString();

    connection.sendIQ(iq, function() {
      delete roster[userId];
      if (typeof callback === 'function') callback();
    });
  },

  _sendSubscriptionPresence: function(params) {
    var pres;

    pres = $pres({
      to: params.jid,
      type: params.type
    });

    connection.send(pres);
  }

};

/* Chat module: Group Chat
 *
 * Multi-User Chat
 * http://xmpp.org/extensions/xep-0045.html
 *
---------------------------------------------------------------------- */
function MucProxy(service) {
  this.service = service;
  this.helpers = new Helpers;
}

MucProxy.prototype = {

  join: function(jid, callback) {
    var pres, self = this,
        id = connection.getUniqueId('join');

    joinedRooms[jid] = true;

    pres = $pres({
      from: connection.jid,
      to: self.helpers.getRoomJid(jid),
      id: id
    }).c("x", {
      xmlns: Strophe.NS.MUC
    }).c("history", {
      maxstanzas: 0
    });

    if (typeof callback === 'function') connection.addHandler(callback, null, 'presence', null, id);
    connection.send(pres);
  },

  leave: function(jid, callback) {
    var pres, self = this,
        roomJid = self.helpers.getRoomJid(jid);

    delete joinedRooms[jid];

    pres = $pres({
      from: connection.jid,
      to: roomJid,
      type: 'unavailable'
    });

    if (typeof callback === 'function') connection.addHandler(callback, null, 'presence', 'unavailable', null, roomJid);
    connection.send(pres);
  }

};

/* Chat module: History
---------------------------------------------------------------------- */

// Dialogs

function DialogProxy(service) {
  this.service = service;
  this.helpers = new Helpers;
}

DialogProxy.prototype = {

  list: function(params, callback) {
    if (typeof params === 'function' && typeof callback === 'undefined') {
      callback = params;
      params = {};
    }

    if (config.debug) { console.log('DialogProxy.list', params); }
    this.service.ajax({url: Utils.getUrl(dialogUrl), data: params}, callback);
  },

  create: function(params, callback) {
    if (config.debug) { console.log('DialogProxy.create', params); }
    this.service.ajax({url: Utils.getUrl(dialogUrl), type: 'POST', data: params}, callback);
  },

  update: function(id, params, callback) {
    if (config.debug) { console.log('DialogProxy.update', id, params); }
    this.service.ajax({url: Utils.getUrl(dialogUrl, id), type: 'PUT', data: params}, callback);
  },

  delete: function(id, callback) {
    if (config.debug) { console.log('DialogProxy.delete', id); }
    this.service.ajax({url: Utils.getUrl(dialogUrl, id), type: 'DELETE', dataType: 'text'}, callback);
  }

};

// Messages

function MessageProxy(service) {
  this.service = service;
  this.helpers = new Helpers;
}

MessageProxy.prototype = {

  list: function(params, callback) {
    if (config.debug) { console.log('MessageProxy.list', params); }
    this.service.ajax({url: Utils.getUrl(messageUrl), data: params}, callback);
  },

  create: function(params, callback) {
    if (config.debug) { console.log('MessageProxy.create', params); }
    this.service.ajax({url: Utils.getUrl(messageUrl), type: 'POST', data: params}, callback);
  },

  update: function(id, params, callback) {
    if (config.debug) { console.log('MessageProxy.update', id, params); }
    this.service.ajax({url: Utils.getUrl(messageUrl, id), type: 'PUT', data: params}, callback);
  },

  delete: function(id, callback) {
    if (config.debug) { console.log('MessageProxy.delete', id); }
    this.service.ajax({url: Utils.getUrl(messageUrl, id), type: 'DELETE', dataType: 'text'}, callback);
  }

};

/* Helpers
---------------------------------------------------------------------- */
function Helpers() {}

Helpers.prototype = {

  getUserJid: function(id, appId) {
    return id + '-' + appId + '@' + config.endpoints.chat;
  },

  getIdFromNode: function(jid) {
    if (jid.indexOf('@') < 0) return null;
    return parseInt(jid.split('@')[0].split('-')[0]);
  },

  getDialogIdFromNode: function(jid) {
    if (jid.indexOf('@') < 0) return null;
    return jid.split('@')[0].split('_')[1];
  },

  getRoomJid: function(jid) {
    if(!isBrowser) throw unsupported;
    return jid + '/' + this.getIdFromNode(connection.jid);
  },  

  getIdFromResource: function(jid) {
    var s = jid.split('/');
    if (s.length < 2) return null;
    s.splice(0, 1);
    return parseInt(s.join('/'));
  },

  getUniqueId: function(suffix) {
    if(!isBrowser) throw unsupported;
    return connection.getUniqueId(suffix);
  },

  getBsonObjectId: function() {
    return Utils.getBsonObjectId();
  }  

};

module.exports = ChatProxy;

/* Private
---------------------------------------------------------------------- */
function trace(text) {
  // if (config.debug) {
    console.log('[QBChat]:', text);
  // }
}

function getError(code, detail) {
  var errorMsg = {
    code: code,
    status: 'error',
    message: code === 401 ? 'Unauthorized' : 'Unprocessable Entity',
    detail: detail
  };

  trace(detail);
  return errorMsg;
}

function getLocalTime() {
  return (new Date).toTimeString().split(' ')[0];
}

},{"../../lib/strophe/strophe.min":15,"../qbConfig":9,"../qbUtils":13}],3:[function(require,module,exports){
/*
 * QuickBlox JavaScript SDK
 *
 * Content module
 *
 * For an overview of this module and what it can be used for
 * see http://quickblox.com/modules/content
 *
 * The API itself is described at http://quickblox.com/developers/Content
 *
 */

var config = require('../qbConfig'),
    Utils = require('../qbUtils');

var taggedForUserUrl = config.urls.blobs + '/tagged';

function ContentProxy(service) {
  this.service = service;
}

ContentProxy.prototype = {
  
  create: function(params, callback){
   if (config.debug) { console.log('ContentProxy.create', params);}
    this.service.ajax({url: Utils.getUrl(config.urls.blobs), data: {blob:params}, type: 'POST'}, function(err,result){
      if (err){ callback(err, null); }
      else { callback (err, result.blob); }
    });
  },

  list: function(params, callback){
    if (typeof params === 'function' && typeof callback ==='undefined') {
      callback = params;
      params = null;
    }
    this.service.ajax({url: Utils.getUrl(config.urls.blobs)}, function(err,result){
      if (err){ callback(err, null); }
      else { callback (err, result); }
    });
  },

  delete: function(id, callback){
    this.service.ajax({url: Utils.getUrl(config.urls.blobs, id), type: 'DELETE', dataType: 'text'}, function(err, result) {
      if (err) { callback(err,null); }
      else { callback(null, true); }
    });
  },

  createAndUpload: function(params, callback){
    var createParams= {}, file, name, type, size, fileId, _this = this;
    if (config.debug) { console.log('ContentProxy.createAndUpload', params);}
    file = params.file;
    name = params.name || file.name;
    type = params.type || file.type;
    size = file.size;
    createParams.name = name;
    createParams.content_type = type;
    if (params.public) { createParams.public = params.public; }
    if (params.tag_list) { createParams.tag_list = params.tag_list; }
    this.create(createParams, function(err,createResult){
      if (err){ callback(err, null); }
      else {
        var uri = parseUri(createResult.blob_object_access.params), uploadParams = { url: (config.ssl ? 'https://' : 'http://') + uri.host }, data = new FormData();
        fileId = createResult.id;
        
        Object.keys(uri.queryKey).forEach(function(val) {
          data.append(val, decodeURIComponent(uri.queryKey[val]));
        });
        data.append('file', file, createResult.name);
        
        uploadParams.data = data;
        _this.upload(uploadParams, function(err, result) {
          if (err) { callback(err, null); }
          else {
            createResult.path = config.ssl ? result.Location.replace('http://', 'https://') : result.Location;
            _this.markUploaded({id: fileId, size: size}, function(err, result){
              if (err) { callback(err, null);}
              else {
                callback(null, createResult);
              }
            });
          }
        });
      }
    });
  },

  upload: function(params, callback){
    this.service.ajax({url: params.url, data: params.data, dataType: 'xml',
                       contentType: false, processData: false, type: 'POST'}, function(err,xmlDoc){
      if (err) { callback (err, null); }
      else {
        // AWS S3 doesn't respond with a JSON structure
        // so parse the xml and return a JSON structure ourselves
        var result = {}, rootElement = xmlDoc.documentElement, children = rootElement.childNodes, i, m;
        for (i = 0, m = children.length; i < m ; i++){
          result[children[i].nodeName] = children[i].childNodes[0].nodeValue;
        } 
        if (config.debug) { console.log('result', result); }
        callback (null, result);
      }
    });
  },

  taggedForCurrentUser: function(callback) {
    this.service.ajax({url: Utils.getUrl(taggedForUserUrl)}, function(err, result) {
      if (err) { callback(err, null); }
      else { callback(null, result); }
    });
  },

  markUploaded: function (params, callback) {
    this.service.ajax({url: Utils.getUrl(config.urls.blobs, params.id + '/complete'), type: 'PUT', data: {size: params.size}, dataType: 'text' }, function(err, res){
      if (err) { callback (err, null); }
      else { callback (null, res); }
    });
  },

  getInfo: function (id, callback) {
    this.service.ajax({url: Utils.getUrl(config.urls.blobs, id)}, function (err, res) {
      if (err) { callback (err, null); }
      else { callback (null, res); }
    });
  },

  getFile: function (uid, callback) {
   this.service.ajax({url: Utils.getUrl(config.urls.blobs, uid)}, function (err, res) {
      if (err) { callback (err, null); }
      else { callback (null, res); }
    });
  },

  getFileUrl: function (id, callback) {
   this.service.ajax({url: Utils.getUrl(config.urls.blobs, id + '/getblobobjectbyid'), type: 'POST'}, function (err, res) {
      if (err) { callback (err, null); }
      else { callback (null, res.blob_object_access.params); }
    });
  },

  update: function (params, callback) {
    var data = {};
    data.blob = {};
    if (typeof params.name !== 'undefined') { data.blob.name = params.name; }
    this.service.ajax({url: Utils.getUrl(config.urls.blobs, params.id), data: data}, function(err, res) {
      if (err) { callback (err, null); }
      else { callback (null, res); } 
    });
  }

};

module.exports = ContentProxy;

// parseUri 1.2.2
// (c) Steven Levithan <stevenlevithan.com>
// MIT License
// http://blog.stevenlevithan.com/archives/parseuri
function parseUri (str) {
  var o   = parseUri.options,
    m   = o.parser[o.strictMode ? "strict" : "loose"].exec(str),
    uri = {},
    i   = 14;

  while (i--) {uri[o.key[i]] = m[i] || "";}

  uri[o.q.name] = {};
  uri[o.key[12]].replace(o.q.parser, function ($0, $1, $2) {
    if ($1) {uri[o.q.name][$1] = $2;}
  });

  return uri;
}

parseUri.options = {
  strictMode: false,
  key: ["source","protocol","authority","userInfo","user","password","host","port","relative","path","directory","file","query","anchor"],
  q:   {
    name:   "queryKey",
    parser: /(?:^|&)([^&=]*)=?([^&]*)/g
  },
  parser: {
    strict: /^(?:([^:\/?#]+):)?(?:\/\/((?:(([^:@]*)(?::([^:@]*))?)?@)?([^:\/?#]*)(?::(\d*))?))?((((?:[^?#\/]*\/)*)([^?#]*))(?:\?([^#]*))?(?:#(.*))?)/,
    loose:  /^(?:(?![^:@]+:[^:@\/]*@)([^:\/?#.]+):)?(?:\/\/)?((?:(([^:@]*)(?::([^:@]*))?)?@)?([^:\/?#]*)(?::(\d*))?)(((\/(?:[^?#](?![^?#\/]*\.[^?#\/.]+(?:[?#]|$)))*\/?)?([^?#\/]*))(?:\?([^#]*))?(?:#(.*))?)/
  }
};

},{"../qbConfig":9,"../qbUtils":13}],4:[function(require,module,exports){
/*
 * QuickBlox JavaScript SDK
 *
 * Custom Objects module
 *
 */

var config = require('../qbConfig'),
    Utils = require('../qbUtils');

function DataProxy(service){
  this.service = service;
  if (config.debug) { console.log("LocationProxy", service); }
}

DataProxy.prototype = {

  create: function(className, data, callback) {
    if (config.debug) { console.log('DataProxy.create', className, data);}
    this.service.ajax({url: Utils.getUrl(config.urls.data, className), data: data, type: 'POST'}, function(err,res){
      if (err){ callback(err, null); }
      else { callback (err, res); }
    });
  },

  list: function(className, filters, callback) {
    // make filters an optional parameter
    if (typeof callback === 'undefined' && typeof filters === 'function') {
      callback = filters;
      filters = null;
    }
    if (config.debug) { console.log('DataProxy.list', className, filters);}
    this.service.ajax({url: Utils.getUrl(config.urls.data, className), data: filters}, function(err,result){
      if (err){ callback(err, null); }
      else { callback (err, result); }
    });
  },

  update: function(className, data, callback) {
    if (config.debug) { console.log('DataProxy.update', className, data);}
    this.service.ajax({url: Utils.getUrl(config.urls.data, className + '/' + data._id), data: data, type: 'PUT'}, function(err,result){
      if (err){ callback(err, null); }
      else { callback (err, result); }
    });
  },

  delete: function(className, id, callback) {
    if (config.debug) { console.log('DataProxy.delete', className, id);}
    this.service.ajax({url: Utils.getUrl(config.urls.data, className + '/' + id), type: 'DELETE', dataType: 'text'},
                      function(err,result){
                        if (err){ callback(err, null); }
                        else { callback (err, true); }
                      });
  },

  uploadFile: function(className, params, callback) {
    var formData;
    if (config.debug) { console.log('DataProxy.uploadFile', className, params);}
    formData = new FormData();
    formData.append('field_name', params.field_name);
    formData.append('file', params.file);
    this.service.ajax({url: Utils.getUrl(config.urls.data, className + '/' + params.id + '/file'), data: formData,
                      contentType: false, processData: false, type:'POST'}, function(err, result){
                        if (err) { callback(err, null);}
                        else { callback (err, result); }
                      });
  },

  updateFile: function(className, params, callback) {
    var formData;
    if (config.debug) { console.log('DataProxy.updateFile', className, params);}
    formData = new FormData();
    formData.append('field_name', params.field_name);
    formData.append('file', params.file);
    this.service.ajax({url: Utils.getUrl(config.urls.data, className + '/' + params.id + '/file'), data: formData,
                      contentType: false, processData: false, type: 'POST'}, function(err, result) {
                        if (err) { callback (err, null); }
                        else { callback (err, result); }
                      });
  },

  downloadFile: function(className, params, callback) {
    if (config.debug) { console.log('DataProxy.downloadFile', className, params); }
    var result = Utils.getUrl(config.urls.data, className + '/' + params.id + '/file');
    result += '?field_name=' + params.field_name + '&token=' + this.service.getSession().token;
    callback(null, result);
  },

  deleteFile: function(className, params, callback) {
    if (config.debug) { console.log('DataProxy.deleteFile', className, params);}
    this.service.ajax({url: Utils.getUrl(config.urls.data, className + '/' + params.id + '/file'), data: {field_name: params.field_name},
                      dataType: 'text', type: 'DELETE'}, function(err, result) {
                        if (err) { callback (err, null); }
                        else { callback (err, true); }
                      });
  }
  
};

module.exports = DataProxy;

},{"../qbConfig":9,"../qbUtils":13}],5:[function(require,module,exports){
/*
 * QuickBlox JavaScript SDK
 *
 * Location module
 *
 */

var config = require('../qbConfig'),
    Utils = require('../qbUtils');

var geoFindUrl = config.urls.geodata + '/find';

function LocationProxy(service){
  this.service = service;
  this.geodata = new GeoProxy(service);
  this.places = new PlacesProxy(service);
  if (config.debug) { console.log("LocationProxy", service); }
}

function GeoProxy(service){
  this.service = service;
}

GeoProxy.prototype = {

  create: function(params, callback){
    if (config.debug) { console.log('GeoProxy.create', {geo_data: params});}
    this.service.ajax({url: Utils.getUrl(config.urls.geodata), data: {geo_data: params}, type: 'POST'}, function(err,result){
      if (err){ callback(err, null); }
      else { callback (err, result.geo_datum); }
    });
  },

  update: function(params, callback){
    var allowedProps = ['longitude', 'latitude', 'status'], prop, msg = {};
    for (prop in params) {
      if (params.hasOwnProperty(prop)) {
        if (allowedProps.indexOf(prop)>0) {
          msg[prop] = params[prop];
        } 
      }
    }
    if (config.debug) { console.log('GeoProxy.create', params);}
    this.service.ajax({url: Utils.getUrl(config.urls.geodata, params.id), data: {geo_data:msg}, type: 'PUT'},
                     function(err,res){
                      if (err) { callback(err,null);}
                      else { callback(err, res.geo_datum);}
                     });
  },

  get: function(id, callback){
    if (config.debug) { console.log('GeoProxy.get', id);}
    this.service.ajax({url: Utils.getUrl(config.urls.geodata, id)}, function(err,result){
       if (err) { callback (err, null); }
       else { callback(null, result.geo_datum); }
    });
  },

  list: function(params, callback){
    if (typeof params === 'function') {
      callback = params;
      params = undefined;
    }
    if (config.debug) { console.log('GeoProxy.find', params);}
    this.service.ajax({url: Utils.getUrl(geoFindUrl), data: params}, callback);
  },

  delete: function(id, callback){
    if (config.debug) { console.log('GeoProxy.delete', id); }
    this.service.ajax({url: Utils.getUrl(config.urls.geodata, id), type: 'DELETE', dataType: 'text'},
                     function(err,res){
                      if (err) { callback(err, null);}
                      else { callback(null, true);}
                     });
  },

  purge: function(days, callback){
    if (config.debug) { console.log('GeoProxy.purge', days); }
    this.service.ajax({url: Utils.getUrl(config.urls.geodata), data: {days: days}, type: 'DELETE', dataType: 'text'},
                     function(err, res){
                      if (err) { callback(err, null);}
                      else { callback(null, true);}
                     });
  }

};

function PlacesProxy(service) {
  this.service = service;
}

PlacesProxy.prototype = {

  list: function(params, callback){
    if (config.debug) { console.log('PlacesProxy.list', params);}
    this.service.ajax({url: Utils.getUrl(config.urls.places)}, callback);
  },

  create: function(params, callback){
    if (config.debug) { console.log('PlacesProxy.create', params);}
    this.service.ajax({url: Utils.getUrl(config.urls.places), data: {place:params}, type: 'POST'}, callback);
  },

  get: function(id, callback){
    if (config.debug) { console.log('PlacesProxy.get', id);}
    this.service.ajax({url: Utils.getUrl(config.urls.places, id)}, callback);
  },

  update: function(place, callback){
    if (config.debug) { console.log('PlacesProxy.update', place);}
    this.service.ajax({url: Utils.getUrl(config.urls.places, place.id), data: {place: place}, type: 'PUT'} , callback);
  },

  delete: function(id, callback){
    if (config.debug) { console.log('PlacesProxy.delete', id);}
    this.service.ajax({url: Utils.getUrl(config.urls.places, id), type: 'DELETE', dataType: 'text'}, callback);
  }

};

module.exports = LocationProxy;

},{"../qbConfig":9,"../qbUtils":13}],6:[function(require,module,exports){
/*
 * QuickBlox JavaScript SDK
 *
 * Messages Module
 *
 */

var config = require('../qbConfig'),
    Utils = require('../qbUtils');

function MessagesProxy(service) {
  this.service = service;
  this.tokens = new TokensProxy(service);
  this.subscriptions = new SubscriptionsProxy(service);
  this.events = new EventsProxy(service);
}

// Push Tokens

function TokensProxy(service){
  this.service = service;
}

TokensProxy.prototype = {
  
  create: function(params, callback){
    var message = {
      push_token: {
        environment: params.environment,
        client_identification_sequence: params.client_identification_sequence
      },
      device: { platform: params.platform, udid: params.udid}
    };
    if (config.debug) { console.log('TokensProxy.create', message);}
    this.service.ajax({url: Utils.getUrl(config.urls.pushtokens), type: 'POST', data: message},
                      function(err, data){
                        if (err) { callback(err, null);}
                        else { callback(null, data.push_token); }
                      });
  },

  delete: function(id, callback) {
    if (config.debug) { console.log('MessageProxy.deletePushToken', id); }
    this.service.ajax({url: Utils.getUrl(config.urls.pushtokens, id), type: 'DELETE', dataType:'text'}, 
                      function (err, res) {
                        if (err) {callback(err, null);}
                        else {callback(null, true);}
                        });
  }

};

// Subscriptions

function SubscriptionsProxy(service){
  this.service = service;
}

SubscriptionsProxy.prototype = {

  create: function(params, callback) {
    if (config.debug) { console.log('MessageProxy.createSubscription', params); }
    this.service.ajax({url: Utils.getUrl(config.urls.subscriptions), type: 'POST', data: params}, callback);
  },

  list: function(callback) {
    if (config.debug) { console.log('MessageProxy.listSubscription'); }
    this.service.ajax({url: Utils.getUrl(config.urls.subscriptions)}, callback);
  },

  delete: function(id, callback) {
    if (config.debug) { console.log('MessageProxy.deleteSubscription', id); }
    this.service.ajax({url: Utils.getUrl(config.urls.subscriptions, id), type: 'DELETE', dataType:'text'}, 
                      function(err, res){
                        if (err) { callback(err, null);}
                        else { callback(null, true);}
                      });
  }

};

// Events
function EventsProxy(service){
  this.service = service;
}

EventsProxy.prototype = {

  create: function(params, callback) {
    if (config.debug) { console.log('MessageProxy.createEvent', params); }
    var message = {event: params};
    this.service.ajax({url: Utils.getUrl(config.urls.events), type: 'POST', data: message}, callback);
  },

  list: function(callback) {
   if (config.debug) { console.log('MessageProxy.listEvents'); }
    this.service.ajax({url: Utils.getUrl(config.urls.events)}, callback);
  },

  get: function(id, callback) {
    if (config.debug) { console.log('MessageProxy.getEvents', id); }
    this.service.ajax({url: Utils.getUrl(config.urls.events, id)}, callback);
  },

  update: function(params, callback) {
    if (config.debug) { console.log('MessageProxy.createEvent', params); }
    var message = {event: params};
    this.service.ajax({url: Utils.getUrl(config.urls.events, params.id), type: 'PUT', data: message}, callback);
  },

  delete: function(id, callback) {
    if (config.debug) { console.log('MessageProxy.deleteEvent', id); }
    this.service.ajax({url: Utils.getUrl(config.urls.events, id), type: 'DELETE'}, callback);
  }

};

module.exports = MessagesProxy;

},{"../qbConfig":9,"../qbUtils":13}],7:[function(require,module,exports){
/*
 * QuickBlox JavaScript SDK
 *
 * Users Module
 *
 */

var config = require('../qbConfig'),
    Utils = require('../qbUtils');

var DATE_FIELDS = ['created_at', 'updated_at', 'last_request_at'];
var NUMBER_FIELDS = ['id', 'external_user_id'];

var resetPasswordUrl = config.urls.users + '/password/reset';

function UsersProxy(service) {
  this.service = service;
}

UsersProxy.prototype = {

  listUsers: function(params, callback) {
    var message = {}, filters = [], item;
    
    if (typeof params === 'function' && typeof callback === 'undefined') {
      callback = params;
      params = {};
    }
    
    if (params.filter) {
      if (params.filter instanceof Array) {
        params.filter.forEach(function(el) {
          item = generateFilter(el);
          filters.push(item);
        });
      } else {
        item = generateFilter(params.filter);
        filters.push(item);
      }
      message.filter = filters;
    }
    if (params.order) {
      message.order = generateOrder(params.order);
    }
    if (params.page) {
      message.page = params.page;
    }
    if (params.per_page) {
      message.per_page = params.per_page;
    }
    
    if (config.debug) { console.log('UsersProxy.listUsers', message); }
    this.service.ajax({url: Utils.getUrl(config.urls.users), data: message}, callback);
  },

  get: function(params, callback) {
    var url;
    
    if (typeof params === 'number') {
      url = params;
      params = {};
    } else {
      if (params.login) {
        url = 'by_login';
      } else if (params.full_name) {
        url = 'by_full_name';
      } else if (params.facebook_id) {
        url = 'by_facebook_id';
      } else if (params.twitter_id) {
        url = 'by_twitter_id';
      } else if (params.email) {
        url = 'by_email';
      } else if (params.tags) {
        url = 'by_tags';
      } else if (params.external) {
        url = 'external/' + params.external;
        params = {};
      }
    }
    
    if (config.debug) { console.log('UsersProxy.get', params); }
    this.service.ajax({url: Utils.getUrl(config.urls.users, url), data: params},
                      function(err, res) {
                        if (err) { callback(err, null); }
                        else { callback(null, res.user || res); }
                      });
  },

  create: function(params, callback) {
    if (config.debug) { console.log('UsersProxy.create', params); }
    this.service.ajax({url: Utils.getUrl(config.urls.users), type: 'POST', data: {user: params}},
                      function(err, res) {
                        if (err) { callback(err, null); }
                        else { callback(null, res.user); }
                      });
  },

  update: function(id, params, callback) {
    if (config.debug) { console.log('UsersProxy.update', id, params); }
    this.service.ajax({url: Utils.getUrl(config.urls.users, id), type: 'PUT', data: {user: params}},
                      function(err, res) {
                        if (err) { callback(err, null); }
                        else { callback(null, res.user); }
                      });
  },

  delete: function(params, callback) {
    var url;
    
    if (typeof params === 'number') {
      url = params;
    } else {
      if (params.external) {
        url = 'external/' + params.external;
      }
    }
    
    if (config.debug) { console.log('UsersProxy.delete', url); }
    this.service.ajax({url: Utils.getUrl(config.urls.users, url), type: 'DELETE', dataType: 'text'}, callback);
  },

  resetPassword: function(email, callback) {
    if (config.debug) { console.log('UsersProxy.resetPassword', email); }
    this.service.ajax({url: Utils.getUrl(resetPasswordUrl), data: {email: email}}, callback);
  }

};

module.exports = UsersProxy;

/* Private
---------------------------------------------------------------------- */
function generateFilter(obj) {
  var type = obj.field in DATE_FIELDS ? 'date' : typeof obj.value;
  
  if (obj.value instanceof Array) {
    if (type == 'object') {
      type = typeof obj.value[0];
    }
    obj.value = obj.value.toString();
  }
  
  return [type, obj.field, obj.param, obj.value].join(' ');
}

function generateOrder(obj) {
  var type = obj.field in DATE_FIELDS ? 'date' : obj.field in NUMBER_FIELDS ? 'number' : 'string';
  return [obj.sort, type, obj.field].join(' ');
}

},{"../qbConfig":9,"../qbUtils":13}],8:[function(require,module,exports){
/*
 * QuickBlox JavaScript SDK
 *
 * WebRTC Module
 *
 */

/*
 * User's callbacks (listener-functions):
 * - onCallListener
 * - onAcceptCallListener
 * - onRejectCallListener
 * - onStopCallListener
 * - onUpdateCallListener
 * - onRemoteStreamListener
 */

require('../../lib/strophe/strophe.min');
var download = require('../../lib/download/download.min');

var config = require('../qbConfig'),
    Utils = require('../qbUtils');

// cross-browser polyfill
var RTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
var RTCSessionDescription = window.RTCSessionDescription || window.mozRTCSessionDescription;
var RTCIceCandidate = window.RTCIceCandidate || window.mozRTCIceCandidate;
var getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
var URL = window.URL || window.webkitURL;

var signalingType = {
  CALL: 'call',
  ACCEPT: 'accept',
  REJECT: 'reject',
  STOP: 'hangUp',
  CANDIDATE: 'iceCandidates',
  PARAMETERS_CHANGED: 'update'
};

var stopCallReason = {
  MANUALLY: 'manually',
  BAD_CONNECTION: 'bad_connection',
  CANCEL: 'cancel',
  NOT_ANSWER: 'not_answer'
};

var WEBRTC_MODULE_ID = 'WebRTCVideoChat';

var connection, peer,
    callers = {};

/* WebRTC module: Core
--------------------------------------------------------------------------------- */
function WebRTCProxy(service, conn) {
  var self = this;
  connection = conn;

  this.service = service;
  this.helpers = new Helpers;

  this._onMessage = function(stanza) {
    var from = stanza.getAttribute('from'),
        extraParams = stanza.querySelector('extraParams'),
        delay = stanza.querySelector('delay'),
        userId = self.helpers.getIdFromNode(from),
        extension = self._getExtension(extraParams);
    
    if (delay || extension.moduleIdentifier !== WEBRTC_MODULE_ID) return true;

    // clean for users
    delete extension.moduleIdentifier;

    switch (extension.signalType) {
    case signalingType.CALL:
      trace('onCall from ' + userId);
      if (callers[userId]) return true;
      callers[userId] = {
        sessionID: extension.sessionID,
        sdp: extension.sdp
      };
      extension.callType = extension.callType === '1' ? 'video' : 'audio';
      delete extension.sdp;
      if (typeof self.onCallListener === 'function')
        self.onCallListener(userId, extension);
      break;
    case signalingType.ACCEPT:
      trace('onAccept from ' + userId);
      if (typeof peer === 'object')
        peer.onRemoteSessionCallback(extension.sdp, 'answer');
      delete extension.sdp;
      if (typeof self.onAcceptCallListener === 'function')
        self.onAcceptCallListener(userId, extension);
      break;
    case signalingType.REJECT:
      trace('onReject from ' + userId);
      self._close();
      if (typeof self.onRejectCallListener === 'function')
        self.onRejectCallListener(userId, extension);
      break;
    case signalingType.STOP:
      trace('onStop from ' + userId);
      if (callers[userId]) delete callers[userId];
      self._checkReason(extension.reason);
      if (typeof self.onStopCallListener === 'function')
        self.onStopCallListener(userId, extension);
      break;
    case signalingType.CANDIDATE:
      if (typeof peer === 'object') {
        peer.addCandidates(extension.iceCandidates);
        if (peer.type === 'answer')
          self._sendCandidate(peer.opponentId, peer.iceCandidates);
      }
      break;
    case signalingType.PARAMETERS_CHANGED:
      trace('onUpdateCall from ' + userId);
      if (typeof self.onUpdateCallListener === 'function')
        self.onUpdateCallListener(userId, extension);
      break;
    }
    
    // we must return true to keep the handler alive
    // returning false would remove it after it finishes
    return true;
  };

  this._getExtension = function(extraParams) {
    var extension = {}, iceCandidates = [], opponents = [],
        candidate, oponnent, items, childrenNodes;

    if (extraParams) {
      for (var i = 0, len = extraParams.childNodes.length; i < len; i++) {
        if (extraParams.childNodes[i].tagName === 'iceCandidates') {
        
          // iceCandidates
          items = extraParams.childNodes[i].childNodes;
          for (var j = 0, len2 = items.length; j < len2; j++) {
            candidate = {};
            childrenNodes = items[j].childNodes;
            for (var k = 0, len3 = childrenNodes.length; k < len3; k++) {
              candidate[childrenNodes[k].tagName] = childrenNodes[k].textContent;
            }
            iceCandidates.push(candidate);
          }

        } else if (extraParams.childNodes[i].tagName === 'opponentsIDs') {

          // opponentsIDs
          items = extraParams.childNodes[i].childNodes;
          for (var j = 0, len2 = items.length; j < len2; j++) {
            oponnent = items[j].textContent;
            opponents.push(oponnent);
          }

        } else {
          if (extraParams.childNodes[i].childNodes.length > 1) {

            extension = self._XMLtoJS(extension, extraParams.childNodes[i].tagName, extraParams.childNodes[i]);

          } else {

            extension[extraParams.childNodes[i].tagName] = extraParams.childNodes[i].textContent;

          }
        }
      }
      if (iceCandidates.length > 0)
        extension.iceCandidates = iceCandidates;
      if (opponents.length > 0)
        extension.opponents = opponents;
    }

    return extension;
  };

  this._checkReason = function(reason) {
    var self = this;

    if (reason === stopCallReason.MANUALLY) {
      self._close();
    }
  };
}

/* WebRTC module: User Media Steam
--------------------------------------------------------------------------------- */
// get local stream from user media interface (web-camera, microphone)
WebRTCProxy.prototype.getUserMedia = function(params, callback) {
  if (!getUserMedia) throw new Error('getUserMedia() is not supported in your browser');
  getUserMedia = getUserMedia.bind(navigator);
  var self = this;

  // Additional parameters for Media Constraints
  // http://tools.ietf.org/html/draft-alvestrand-constraints-resolution-00
  /**********************************************
   * googEchoCancellation: true
   * googAutoGainControl: true
   * googNoiseSuppression: true
   * googHighpassFilter: true
   * minWidth: 640
   * minHeight: 480
   * maxWidth: 1280
   * maxHeight: 720
   * minFrameRate: 60
   * maxAspectRatio: 1.333
  **********************************************/
  getUserMedia(
    {
      audio: params.audio || false,
      video: params.video || false
    },

    function(stream) {
      self.localStream = stream;
      if (params.elemId)
        self.attachMediaStream(params.elemId, stream, params.options);
      callback(null, stream);
    },

    function(err) {
      callback(err, null);
    }
  );
};

// attach media stream to audio/video element
WebRTCProxy.prototype.attachMediaStream = function(id, stream, options) {
  var elem = document.getElementById(id);
  if (elem) {
    elem.src = URL.createObjectURL(stream);
    if (options && options.muted) elem.muted = true;
    if (options && options.mirror) {
      elem.style.webkitTransform = 'scaleX(-1)';
      elem.style.transform = 'scaleX(-1)';
    }
    elem.play();
  }
};

WebRTCProxy.prototype.snapshot = function(id) {
  var video = document.getElementById(id),
      canvas = document.createElement('canvas'),
      context = canvas.getContext('2d'),
      dataURL, blob;
  
  if (video) {
    canvas.width = video.clientWidth;
    canvas.height = video.clientHeight;
    if (video.style.transform === 'scaleX(-1)') {
      context.translate(canvas.width, 0);
      context.scale(-1, 1);
    }
    context.drawImage(video, 0, 0, video.clientWidth, video.clientHeight);
    dataURL = canvas.toDataURL();

    blob = dataURItoBlob(dataURL, 'image/png');
    blob.name = 'snapshot_' + getLocalTime() + '.png';
    blob.url = dataURL;

    return blob;
  }
};

// add CSS filters to video stream
// http://css-tricks.com/almanac/properties/f/filter/
WebRTCProxy.prototype.filter = function(id, filters) {
  var video = document.getElementById(id);
  if (video) {
    video.style.webkitFilter = filters;
    video.style.filter = filters;
  }
};

WebRTCProxy.prototype.mute = function(type) {
  this._switchOffDevice(0, type);
};

WebRTCProxy.prototype.unmute = function(type) {
  this._switchOffDevice(1, type);
};

WebRTCProxy.prototype._switchOffDevice = function(bool, type) {
  if (type === 'audio' && this.localStream.getAudioTracks().length > 0) {
    this.localStream.getAudioTracks().forEach(function (track) {
      track.enabled = !!bool;
    });
  }
  if (type === 'video' && this.localStream.getVideoTracks().length > 0) {
    this.localStream.getVideoTracks().forEach(function (track) {
      track.enabled = !!bool;
    });
  }
};

/* WebRTC module: Real-Time Communication (Signaling)
--------------------------------------------------------------------------------- */
WebRTCProxy.prototype._createPeer = function(params) {
  if (!RTCPeerConnection) throw new Error('RTCPeerConnection() is not supported in your browser');
  if (!this.localStream) throw new Error("You don't have an access to the local stream");
  var pcConfig = {
    iceServers: config.iceServers
  };
  
  // Additional parameters for RTCPeerConnection options
  // new RTCPeerConnection(pcConfig, options)
  /**********************************************
   * DtlsSrtpKeyAgreement: true
   * RtpDataChannels: true
  **********************************************/
  peer = new RTCPeerConnection(pcConfig);
  peer.init(this, params);
  trace('SessionID ' + peer.sessionID);
  trace(peer);
};

WebRTCProxy.prototype.call = function(opponentsIDs, callType, extension) {
  this._createPeer();

  var self = this;
  // TODO: need to add a posibility created group calls
  var ids = opponentsIDs instanceof Array ? opponentsIDs : [opponentsIDs];

  peer.opponentId = ids[0];
  peer.getSessionDescription(function(err, res) {
    if (err) {
      trace(err);
    } else {
      trace('call ' + peer.opponentId);
      self._sendMessage(peer.opponentId, extension, 'CALL', callType, ids);
    }
  });
};

WebRTCProxy.prototype.accept = function(userId, extension) {
  if (callers[userId]) {
    this._createPeer({
      sessionID: callers[userId].sessionID,
      description: callers[userId].sdp
    });
    delete callers[userId];
  }
  
  var self = this;
  peer.opponentId = userId;

  peer.getSessionDescription(function(err, res) {
    if (err) {
      trace(err);
    } else {
      trace('accept ' + userId);
      self._sendMessage(userId, extension, 'ACCEPT');
    }
  });
};

WebRTCProxy.prototype.reject = function(userId, extension) {
  var extension = extension || {};

  if (callers[userId]) {
    extension.sessionID = callers[userId].sessionID;
    delete callers[userId];
  }
  trace('reject ' + userId);
  this._sendMessage(userId, extension, 'REJECT');
};

WebRTCProxy.prototype.stop = function(userId, reason, extension) {
  var extension = extension || {},
      status = reason || 'manually';

  extension.reason = stopCallReason[status.toUpperCase()] || reason;
  trace('stop ' + userId);
  this._sendMessage(userId, extension, 'STOP');
  this._close();
};

WebRTCProxy.prototype.update = function(userId, extension) {
  trace('update ' + userId);
  this._sendMessage(userId, extension, 'PARAMETERS_CHANGED');
};

// close peer connection and local stream
WebRTCProxy.prototype._close = function() {
  if (peer) {
    peer.close();
  }
  if (this.localStream) {
    this.localStream.stop();
    this.localStream = null;
  }
};

WebRTCProxy.prototype._sendCandidate = function(userId, iceCandidates) {
  var extension = {
    iceCandidates: iceCandidates
  };
  this._sendMessage(userId, extension, 'CANDIDATE');
};

WebRTCProxy.prototype._sendMessage = function(userId, extension, type, callType, opponentsIDs) {
  var extension = extension || {},
      self = this,
      msg, params;

  extension.moduleIdentifier = WEBRTC_MODULE_ID;
  extension.signalType = signalingType[type];
  extension.sessionID = peer && peer.sessionID || extension.sessionID;

  if (callType) {
    extension.callType = callType === 'video' ? '1' : '2';
  }

  if (type === 'CALL' || type === 'ACCEPT') {    
    extension.sdp = peer.localDescription.sdp;
    extension.platform = 'web';
  }

  if (type === 'CALL') {
    extension.callerID = this.helpers.getIdFromNode(connection.jid);
    extension.opponentsIDs = opponentsIDs;
  }
  
  params = {
    from: connection.jid,
    to: this.helpers.getUserJid(userId, this.service.getSession().application_id),
    type: 'headline',
    id: Utils.getBsonObjectId()
  };
  
  msg = $msg(params).c('extraParams', {
    xmlns: Strophe.NS.CLIENT
  });
  
  Object.keys(extension).forEach(function(field) {
    if (field === 'iceCandidates') {

      // iceCandidates
      msg = msg.c('iceCandidates');
      extension[field].forEach(function(candidate) {
        msg = msg.c('iceCandidate');
        Object.keys(candidate).forEach(function(key) {
          msg.c(key).t(candidate[key]).up();
        });
        msg.up();
      });
      msg.up();

    } else if (field === 'opponentsIDs') {

      // opponentsIDs
      msg = msg.c('opponentsIDs');
      extension[field].forEach(function(opponentId) {
        msg = msg.c('opponentID').t(opponentId).up();
      });
      msg.up();

    } else if (typeof extension[field] === 'object') {

      self._JStoXML(field, extension[field], msg);

    } else {
      msg.c(field).t(extension[field]).up();
    }
  });
  
  connection.send(msg);
};

// TODO: the magic
WebRTCProxy.prototype._JStoXML = function(title, obj, msg) {
  var self = this;
  msg.c(title);
  Object.keys(obj).forEach(function(field) {
    if (typeof obj[field] === 'object')
      self._JStoXML(field, obj[field], msg);
    else
      msg.c(field).t(obj[field]).up();
  });
  msg.up();
};

// TODO: the magic
WebRTCProxy.prototype._XMLtoJS = function(extension, title, obj) {
  var self = this;
  extension[title] = {};
  for (var i = 0, len = obj.childNodes.length; i < len; i++) {
    if (obj.childNodes[i].childNodes.length > 1) {
      extension[title] = self._XMLtoJS(extension[title], obj.childNodes[i].tagName, obj.childNodes[i]);
    } else {
      extension[title][obj.childNodes[i].tagName] = obj.childNodes[i].textContent;
    }
  }
  return extension;
};

/* WebRTC module: RTCPeerConnection extension
--------------------------------------------------------------------------------- */
if (RTCPeerConnection) {

RTCPeerConnection.prototype.init = function(service, options) {
  this.service = service;
  this.sessionID = options && options.sessionID || Date.now();
  this.type = options && options.description ? 'answer' : 'offer';
  
  this.addStream(this.service.localStream);
  this.onicecandidate = this.onIceCandidateCallback;
  this.onaddstream = this.onRemoteStreamCallback;
  this.onsignalingstatechange = this.onSignalingStateCallback;
  this.oniceconnectionstatechange = this.onIceConnectionStateCallback;  

  if (this.type === 'answer') {
    this.onRemoteSessionCallback(options.description, 'offer');
  }
};

RTCPeerConnection.prototype.getSessionDescription = function(callback) {
  if (peer.type === 'offer') {
    // Additional parameters for SDP Constraints
    // http://www.w3.org/TR/webrtc/#constraints
    // peer.createOffer(successCallback, errorCallback, constraints)
    peer.createOffer(successCallback, errorCallback);
  } else {
    peer.createAnswer(successCallback, errorCallback);
  }

  function successCallback(desc) {
    peer.setLocalDescription(desc, function() {
      callback(null, desc);
    });
  }
  function errorCallback(error) {
    callback(error, null);
  }
};

RTCPeerConnection.prototype.onIceCandidateCallback = function(event) {
  var candidate = event.candidate;
  if (candidate) {
    peer.iceCandidates = peer.iceCandidates || [];
    peer.iceCandidates.push({
      sdpMLineIndex: candidate.sdpMLineIndex,
      sdpMid: candidate.sdpMid,
      candidate: candidate.candidate
    });
  }
};

// handler of remote session description
RTCPeerConnection.prototype.onRemoteSessionCallback = function(sessionDescription, type) {
  var desc = new RTCSessionDescription({sdp: sessionDescription, type: type});
  this.setRemoteDescription(desc);
};

// handler of remote media stream
RTCPeerConnection.prototype.onRemoteStreamCallback = function(event) {
  if (typeof peer.service.onRemoteStreamListener === 'function')
    peer.service.onRemoteStreamListener(event.stream);
};

RTCPeerConnection.prototype.addCandidates = function(iceCandidates) {
  var candidate;
  for (var i = 0, len = iceCandidates.length; i < len; i++) {
    candidate = {
      sdpMLineIndex: iceCandidates[i].sdpMLineIndex,
      sdpMid: iceCandidates[i].sdpMid,
      candidate: iceCandidates[i].candidate
    };
    this.addIceCandidate(new RTCIceCandidate(candidate));
  }
};

RTCPeerConnection.prototype.onSignalingStateCallback = function() {
  // send candidates
  if (peer && peer.signalingState === 'stable' && peer.type === 'offer')
    peer.service._sendCandidate(peer.opponentId, peer.iceCandidates);
};

RTCPeerConnection.prototype.onIceConnectionStateCallback = function() {
  if (peer.iceConnectionState === 'closed' || peer.iceConnectionState === 'disconnected')
    peer = null;
};

}

/* Helpers
---------------------------------------------------------------------- */
function Helpers() {}

Helpers.prototype = {

  getUserJid: function(id, appId) {
    return id + '-' + appId + '@' + config.endpoints.chat;
  },

  getIdFromNode: function(jid) {
    if (jid.indexOf('@') < 0) return null;
    return parseInt(jid.split('@')[0].split('-')[0]);
  }

};

module.exports = WebRTCProxy;

/* Private
---------------------------------------------------------------------- */
function trace(text) {
  // if (config.debug) {
    console.log('[QBWebRTC]:', text);
  // }
}

function getLocalTime() {
  var arr = (new Date).toString().split(' ');
  return arr.slice(1,5).join('-');
}

// Convert Data URI to Blob
function dataURItoBlob(dataURI, contentType) {
  var arr = [],
      binary = window.atob(dataURI.split(',')[1]);
  
  for (var i = 0, len = binary.length; i < len; i++) {
    arr.push(binary.charCodeAt(i));
  }
  
  return new Blob([new Uint8Array(arr)], {type: contentType});
}

// Download Blob to local file system
Blob.prototype.download = function() {
  download(this, this.name, this.type);
};

},{"../../lib/download/download.min":14,"../../lib/strophe/strophe.min":15,"../qbConfig":9,"../qbUtils":13}],9:[function(require,module,exports){
/* 
 * QuickBlox JavaScript SDK
 *
 * Configuration Module
 *
 */

var config = {
  version: '1.8.0',
  creds: {
    appId: '',
    authKey: '',
    authSecret: ''
  },
  endpoints: {
    api: 'api.quickblox.com',
    chat: 'chat.quickblox.com',
    muc: 'muc.chat.quickblox.com',
    turn: 'turnserver.quickblox.com',
    s3Bucket: 'qbprod'
  },
  chatProtocol: {
    // bosh: 'http://chat.quickblox.com:5280',
    bosh: 'https://chat.quickblox.com:5281', // With SSL
    // websocket: 'ws://chat.quickblox.com:5290',
    websocket: 'wss://chat.quickblox.com:5291', // With SSL
    active: 1
  },
  iceServers: [
    // {
    //   'url': 'stun:stun.l.google.com:19302'
    // },
    // {
    //   'url': 'turn:turnservertest.quickblox.com:3478?transport=udp',
    //   'credential': 'testqbtest',
    //   'username': 'testqb'
    // },
    // {
    //   'url': 'turn:turnservertest.quickblox.com:3478?transport=tcp',
    //   'credential': 'testqbtest',
    //   'username': 'testqb'
    // }

    {
      'url': 'stun:stun.l.google.com:19302'
    },
    {
      'url': 'stun:stun.anyfirewall.com:3478'
    },
    {
      'url': 'stun:turn2.xirsys.com'
    },
    {
      'url': 'turn:turn.bistri.com:80',
      'username': 'homeo',
      'credential': 'homeo'
    },
    {
      'url': 'turn:turn.anyfirewall.com:443?transport=tcp',
      'username': 'webrtc',
      'credential': 'webrtc'
    },
    {
      'url': 'turn:turn2.xirsys.com:443?transport=udp',
      'username': '36b7fdaf-524e-4c38-a6d3-b174166fd573',      
      'credential': '0371abb5-fa95-4bbe-b282-25e5888513f7'
    },
    {
      'url': 'turn:turn2.xirsys.com:443?transport=tcp',
      'username': '36b7fdaf-524e-4c38-a6d3-b174166fd573',      
      'credential': '0371abb5-fa95-4bbe-b282-25e5888513f7'
    }
  ],
  urls: {
    session: 'session',
    login: 'login',
    users: 'users',
    chat: 'chat',
    blobs: 'blobs',
    geodata: 'geodata',
    places: 'places',
    pushtokens: 'push_tokens',
    subscriptions: 'subscriptions',
    events: 'events',
    data: 'data',
    type: '.json'
  },
  on: {
    sessionExpired: null
  },
  ssl: true,
  timeout: null,
  debug: false,
  addISOTime: false
};

config.set = function(options) {
  Object.keys(options).forEach(function(key) {
    if(key !== 'set' && config.hasOwnProperty(key)) {
      if(typeof options[key] !== 'object') {
        config[key] = options[key]
      } else {
        Object.keys(options[key]).forEach(function(nextkey) {
          if(config[key].hasOwnProperty(nextkey))
            config[key][nextkey] = options[key][nextkey];
        });
      }
    }
  })
};

module.exports = config;

},{}],10:[function(require,module,exports){
/*
 * QuickBlox JavaScript SDK
 *
 * Main SDK Module
 *
 */

var config = require('./qbConfig');
var isBrowser = typeof window !== "undefined";

// Actual QuickBlox API starts here
function QuickBlox() {}

QuickBlox.prototype = {

  init: function(appId, authKey, authSecret, debug) {
    if (debug && typeof debug === 'boolean') config.debug = debug;
    else if (debug && typeof debug === 'object') config.set(debug);

    var Proxy = require('./qbProxy');
    this.service = new Proxy();

    // include dependencies
    var Auth = require('./modules/qbAuth'),
        Users = require('./modules/qbUsers'),
        Chat = require('./modules/qbChat'),
        Content = require('./modules/qbContent'),
        Location = require('./modules/qbLocation'),
        Messages = require('./modules/qbMessages'),
        Data = require('./modules/qbData');

    if (isBrowser) {
      // create Strophe Connection object
      var Connection = require('./qbStrophe');
      var conn = new Connection();

      // add WebRTC API
      var WebRTC = require('./modules/qbWebRTC');
      this.webrtc = new WebRTC(this.service, conn || null);
    }
    
    this.auth = new Auth(this.service);
    this.users = new Users(this.service);
    this.chat = new Chat(this.service, this.webrtc || null, conn || null);
    this.content = new Content(this.service);
    this.location = new Location(this.service);
    this.messages = new Messages(this.service);
    this.data = new Data(this.service);
    
    // Initialization by outside token
    if (typeof appId === 'string' && !authKey && !authSecret) {
      this.service.setSession({ token: appId });
    } else {
      config.creds.appId = appId;
      config.creds.authKey = authKey;
      config.creds.authSecret = authSecret;
    }
    if(console && config.debug) console.log('QuickBlox.init', this);
  },

  getSession: function(callback) {
    this.auth.getSession(callback);
  },

  createSession: function(params, callback) {
    this.auth.createSession(params, callback);
  },

  destroySession: function(callback) {
    this.auth.destroySession(callback);
  },

  login: function(params, callback) {
    this.auth.login(params, callback);
  },

  logout: function(callback) {
    this.auth.logout(callback);
  }
  
};

var QB = new QuickBlox();
QB.QuickBlox = QuickBlox;

module.exports = QB;

},{"./modules/qbAuth":1,"./modules/qbChat":2,"./modules/qbContent":3,"./modules/qbData":4,"./modules/qbLocation":5,"./modules/qbMessages":6,"./modules/qbUsers":7,"./modules/qbWebRTC":8,"./qbConfig":9,"./qbProxy":11,"./qbStrophe":12}],11:[function(require,module,exports){
/*
 * QuickBlox JavaScript SDK
 *
 * Proxy Module
 *
 */

var config = require('./qbConfig');
var versionNum = require('../package.json').version;

// For server-side applications through using npm package 'quickblox' you should include the following lines
var isBrowser = typeof window !== 'undefined';
if (!isBrowser) var request = require('request');

var ajax = isBrowser && window.jQuery && window.jQuery.ajax || isBrowser && window.Zepto && window.Zepto.ajax;
if (isBrowser && !ajax) {
  throw new Error('Quickblox requires jQuery or Zepto');
}

function ServiceProxy() {
  this.qbInst = {
    config: config,
    session: null
  };
  if (config.debug) { console.log('ServiceProxy', this.qbInst); }
}

ServiceProxy.prototype = {

  setSession: function(session) {
    this.qbInst.session = session;
  },

  getSession: function() {
    return this.qbInst.session;
  },
  
  handleResponse: function(error, response, next, retry) {
    // can add middleware here...
    var _this = this;
    if(error && typeof config.on.sessionExpired === 'function' && (error.message === 'Unauthorized' || error.status === '401 Unauthorized')) {
      config.on.sessionExpired(function(){next(error,response)}, retry);
    } else {
      if (error) {
        next(error, null);
      } else {
        if (config.addISOTime) response = injectISOTimes(response);
        next(null, response);
      }
    }
  },

  ajax: function(params, callback) {
    if (config.debug) { console.log('ServiceProxy', params.type || 'GET', params); }
    var _this = this,
        retry = function(session) { if(!!session) _this.setSession(session); _this.ajax(params, callback) };
    var ajaxCall = {
      url: params.url,
      type: params.type || 'GET',
      dataType: params.dataType || 'json',
      data: params.data || ' ',
      timeout: config.timeout,
      beforeSend: function(jqXHR, settings) {
        if (config.debug) { console.log('ServiceProxy.ajax beforeSend', jqXHR, settings); }
        if (settings.url.indexOf('://' + config.endpoints.s3Bucket) === -1) {
          if (config.debug) { console.log('setting headers on request to ' + settings.url); }
          if (_this.qbInst.session && _this.qbInst.session.token) {
            jqXHR.setRequestHeader('QB-Token', _this.qbInst.session.token);
            jqXHR.setRequestHeader('QB-SDK', 'JS ' + versionNum + ' - Client');
          }
        }
      },
      success: function(data, status, jqHXR) {
        if (config.debug) { console.log('ServiceProxy.ajax success', data); }
        if (params.url.indexOf(config.urls.session) === -1) _this.handleResponse(null, data, callback, retry);
        else callback(null, data);
      },
      error: function(jqHXR, status, error) {
        if (config.debug) { console.log('ServiceProxy.ajax error', jqHXR.status, error, jqHXR.responseText); }
        var errorMsg = {
          code: jqHXR.status,
          status: status,
          message: error,
          detail: jqHXR.responseText
        };
        if (params.url.indexOf(config.urls.session) === -1) _this.handleResponse(errorMsg, null, callback, retry);
        else callback(errorMsg, null);
      }
    };
  
    if(!isBrowser) {
      
      var isJSONRequest = ajaxCall.dataType === 'json',
        makingQBRequest = params.url.indexOf('://' + config.endpoints.s3Bucket) === -1 && 
                          _this.qbInst && 
                          _this.qbInst.session && 
                          _this.qbInst.session.token ||
                          false;
                          
      var qbRequest = {
        url: ajaxCall.url,
        method: ajaxCall.type,
        timeout: config.timeout,
        json: isJSONRequest ? ajaxCall.data : null,
        form: !isJSONRequest ? ajaxCall.data : null,
        headers: makingQBRequest ? { 'QB-Token' : _this.qbInst.session.token, 'QB-SDK': 'JS ' + versionNum + ' - Server' } : null
      };
          
      var requestCallback = function(error, response, body) {
        if(error || response.statusCode !== 200 && response.statusCode !== 201) {
          var errorMsg;
          try {
            errorMsg = {
              code: response && response.statusCode || error && error.code,
              status: response && response.headers && response.headers.status || 'error',
              message: body || error && error.errno,
              detail: body && body.errors || error && error.syscall
            };
          } catch(e) {
            errorMsg = error;
          }
          if (qbRequest.url.indexOf(config.urls.session) === -1) _this.handleResponse(errorMsg, null, callback, retry);
          else callback(errorMsg, null);
        } else {
          if (qbRequest.url.indexOf(config.urls.session) === -1) _this.handleResponse(null, body, callback, retry);
          else callback(null, body);
        }
      };

    }
    
    // Optional - for example 'multipart/form-data' when sending a file.
    // Default is 'application/x-www-form-urlencoded; charset=UTF-8'
    if (typeof params.contentType === 'boolean' || typeof params.contentType === 'string') { ajaxCall.contentType = params.contentType; }
    if (typeof params.processData === 'boolean') { ajaxCall.processData = params.processData; }
    
    if(isBrowser) {
      ajax( ajaxCall );
    } else {
      request(qbRequest, requestCallback);
    }
  }
  
};

// Date.toISOString polyfill
// Source: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toISOString

if(!Date.prototype.toISOString){(function(){function e(e){if(e<10){return"0"+e}return e}Date.prototype.toISOString=function(){return this.getUTCFullYear()+"-"+e(this.getUTCMonth()+1)+"-"+e(this.getUTCDate())+"T"+e(this.getUTCHours())+":"+e(this.getUTCMinutes())+":"+e(this.getUTCSeconds())+"."+(this.getUTCMilliseconds()/1e3).toFixed(3).slice(2,5)+"Z"}})()}


function injectISOTimes(data) {
  if (data.created_at) {
    if (typeof data.created_at === 'number') data.iso_created_at = new Date(data.created_at * 1000).toISOString();
    if (typeof data.updated_at === 'number') data.iso_updated_at = new Date(data.updated_at * 1000).toISOString();
  }
  else if (data.items) {
    for (var i = 0, len = data.items.length; i < len; ++i) {
      if (typeof data.items[i].created_at === 'number') data.items[i].iso_created_at = new Date(data.items[i].created_at * 1000).toISOString();
      if (typeof data.items[i].updated_at === 'number') data.items[i].iso_updated_at = new Date(data.items[i].updated_at * 1000).toISOString();
    }
  }
  return data;
}

module.exports = ServiceProxy;

},{"../package.json":21,"./qbConfig":9,"request":20}],12:[function(require,module,exports){
/*
 * QuickBlox JavaScript SDK
 *
 * Strophe Connection Object
 *
 */

require('../lib/strophe/strophe.min');
var config = require('./qbConfig');

function Connection() {
  var protocol = config.chatProtocol.active === 1 ? config.chatProtocol.bosh : config.chatProtocol.websocket;
  var conn = new Strophe.Connection(protocol);
  // if (config.debug) {
    if (config.chatProtocol.active === 1) {
      conn.xmlInput = function(data) { if (data.childNodes[0]) {for (var i = 0, len = data.childNodes.length; i < len; i++) { console.log('[QBChat RECV]:', data.childNodes[i]); }} };
      conn.xmlOutput = function(data) { if (data.childNodes[0]) {for (var i = 0, len = data.childNodes.length; i < len; i++) { console.log('[QBChat SENT]:', data.childNodes[i]); }} };
    } else {
      conn.xmlInput = function(data) { console.log('[QBChat RECV]:', data); };
      conn.xmlOutput = function(data) { console.log('[QBChat SENT]:', data); };
    }
  // }

  return conn;
}

module.exports = Connection;

},{"../lib/strophe/strophe.min":15,"./qbConfig":9}],13:[function(require,module,exports){
/*
 * QuickBlox JavaScript SDK
 *
 * Utilities
 *
 */

var config = require('./qbConfig');

// The object for type MongoDB.Bson.ObjectId
// http://docs.mongodb.org/manual/reference/object-id/
var ObjectId = {
  machine: Math.floor(Math.random() * 16777216).toString(16),
  pid: Math.floor(Math.random() * 32767).toString(16),
  increment: 0
};

var Utils = {
  randomNonce: function() {
    return Math.floor(Math.random() * 10000);
  },

  unixTime: function() {
    return Math.floor(Date.now() / 1000);
  },

  getUrl: function(base, id) {
    var protocol = config.ssl ? 'https://' : 'http://';
    var resource = id ? '/' + id : '';
    return protocol + config.endpoints.api + '/' + base + resource + config.urls.type;
  },

  // Generating BSON ObjectId and converting it to a 24 character string representation
  // Changed from https://github.com/justaprogrammer/ObjectId.js/blob/master/src/main/javascript/Objectid.js
  getBsonObjectId: function() {
    var timestamp = this.unixTime().toString(16),
        increment = (ObjectId.increment++).toString(16);

    if (increment > 0xffffff) ObjectId.increment = 0;

    return '00000000'.substr(0, 8 - timestamp.length) + timestamp +
           '000000'.substr(0, 6 - ObjectId.machine.length) + ObjectId.machine +
           '0000'.substr(0, 4 - ObjectId.pid.length) + ObjectId.pid +
           '000000'.substr(0, 6 - increment.length) + increment;
  }
};

module.exports = Utils;

},{"./qbConfig":9}],14:[function(require,module,exports){
function download(data,strFileName,strMimeType){function d2b(u){var p=u.split(/[:;,]/),t=p[1],dec="base64"==p[2]?atob:decodeURIComponent,bin=dec(p.pop()),mx=bin.length,i=0,uia=new Uint8Array(mx);for(i;mx>i;++i)uia[i]=bin.charCodeAt(i);return new B([uia],{type:t})}function saver(url,winMode){if("download"in a)return a.href=url,a.setAttribute("download",fn),a.innerHTML="downloading...",D.body.appendChild(a),setTimeout(function(){a.click(),D.body.removeChild(a),winMode===!0&&setTimeout(function(){self.URL.revokeObjectURL(a.href)},250)},66),!0;if("undefined"!=typeof safari)return url="data:"+url.replace(/^data:([\w\/\-\+]+)/,u),window.open(url)||confirm("Displaying New Document\n\nUse Save As... to download, then click back to return to this page.")&&(location.href=url),!0;var f=D.createElement("iframe");D.body.appendChild(f),winMode||(url="data:"+url.replace(/^data:([\w\/\-\+]+)/,u)),f.src=url,setTimeout(function(){D.body.removeChild(f)},333)}var self=window,u="application/octet-stream",m=strMimeType||u,x=data,D=document,a=D.createElement("a"),z=function(a){return String(a)},B=self.Blob||self.MozBlob||self.WebKitBlob||z;B=B.call?B.bind(self):Blob;var blob,fr,fn=strFileName||"download";if("true"===String(this)&&(x=[x,m],m=x[0],x=x[1]),String(x).match(/^data\:[\w+\-]+\/[\w+\-]+[,;]/))return navigator.msSaveBlob?navigator.msSaveBlob(d2b(x),fn):saver(x);if(blob=x instanceof B?x:new B([x],{type:m}),navigator.msSaveBlob)return navigator.msSaveBlob(blob,fn);if(self.URL)saver(self.URL.createObjectURL(blob),!0);else{if("string"==typeof blob||blob.constructor===z)try{return saver("data:"+m+";base64,"+self.btoa(blob))}catch(y){return saver("data:"+m+","+encodeURIComponent(blob))}fr=new FileReader,fr.onload=function(){saver(this.result)},fr.readAsDataURL(blob)}return!0}module.exports=download;
},{}],15:[function(require,module,exports){
function b64_sha1(s){return binb2b64(core_sha1(str2binb(s),8*s.length))}function str_sha1(s){return binb2str(core_sha1(str2binb(s),8*s.length))}function b64_hmac_sha1(key,data){return binb2b64(core_hmac_sha1(key,data))}function str_hmac_sha1(key,data){return binb2str(core_hmac_sha1(key,data))}function core_sha1(x,len){x[len>>5]|=128<<24-len%32,x[(len+64>>9<<4)+15]=len;var i,j,t,olda,oldb,oldc,oldd,olde,w=new Array(80),a=1732584193,b=-271733879,c=-1732584194,d=271733878,e=-1009589776;for(i=0;i<x.length;i+=16){for(olda=a,oldb=b,oldc=c,oldd=d,olde=e,j=0;80>j;j++)w[j]=16>j?x[i+j]:rol(w[j-3]^w[j-8]^w[j-14]^w[j-16],1),t=safe_add(safe_add(rol(a,5),sha1_ft(j,b,c,d)),safe_add(safe_add(e,w[j]),sha1_kt(j))),e=d,d=c,c=rol(b,30),b=a,a=t;a=safe_add(a,olda),b=safe_add(b,oldb),c=safe_add(c,oldc),d=safe_add(d,oldd),e=safe_add(e,olde)}return[a,b,c,d,e]}function sha1_ft(t,b,c,d){return 20>t?b&c|~b&d:40>t?b^c^d:60>t?b&c|b&d|c&d:b^c^d}function sha1_kt(t){return 20>t?1518500249:40>t?1859775393:60>t?-1894007588:-899497514}function core_hmac_sha1(key,data){var bkey=str2binb(key);bkey.length>16&&(bkey=core_sha1(bkey,8*key.length));for(var ipad=new Array(16),opad=new Array(16),i=0;16>i;i++)ipad[i]=909522486^bkey[i],opad[i]=1549556828^bkey[i];var hash=core_sha1(ipad.concat(str2binb(data)),512+8*data.length);return core_sha1(opad.concat(hash),672)}function safe_add(x,y){var lsw=(65535&x)+(65535&y),msw=(x>>16)+(y>>16)+(lsw>>16);return msw<<16|65535&lsw}function rol(num,cnt){return num<<cnt|num>>>32-cnt}function str2binb(str){for(var bin=[],mask=255,i=0;i<8*str.length;i+=8)bin[i>>5]|=(str.charCodeAt(i/8)&mask)<<24-i%32;return bin}function binb2str(bin){for(var str="",mask=255,i=0;i<32*bin.length;i+=8)str+=String.fromCharCode(bin[i>>5]>>>24-i%32&mask);return str}function binb2b64(binarray){for(var triplet,j,tab="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",str="",i=0;i<4*binarray.length;i+=3)for(triplet=(binarray[i>>2]>>8*(3-i%4)&255)<<16|(binarray[i+1>>2]>>8*(3-(i+1)%4)&255)<<8|binarray[i+2>>2]>>8*(3-(i+2)%4)&255,j=0;4>j;j++)str+=8*i+6*j>32*binarray.length?"=":tab.charAt(triplet>>6*(3-j)&63);return str}var Base64=function(){var keyStr="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",obj={encode:function(input){var chr1,chr2,chr3,enc1,enc2,enc3,enc4,output="",i=0;do chr1=input.charCodeAt(i++),chr2=input.charCodeAt(i++),chr3=input.charCodeAt(i++),enc1=chr1>>2,enc2=(3&chr1)<<4|chr2>>4,enc3=(15&chr2)<<2|chr3>>6,enc4=63&chr3,isNaN(chr2)?enc3=enc4=64:isNaN(chr3)&&(enc4=64),output=output+keyStr.charAt(enc1)+keyStr.charAt(enc2)+keyStr.charAt(enc3)+keyStr.charAt(enc4);while(i<input.length);return output},decode:function(input){var chr1,chr2,chr3,enc1,enc2,enc3,enc4,output="",i=0;input=input.replace(/[^A-Za-z0-9\+\/\=]/g,"");do enc1=keyStr.indexOf(input.charAt(i++)),enc2=keyStr.indexOf(input.charAt(i++)),enc3=keyStr.indexOf(input.charAt(i++)),enc4=keyStr.indexOf(input.charAt(i++)),chr1=enc1<<2|enc2>>4,chr2=(15&enc2)<<4|enc3>>2,chr3=(3&enc3)<<6|enc4,output+=String.fromCharCode(chr1),64!=enc3&&(output+=String.fromCharCode(chr2)),64!=enc4&&(output+=String.fromCharCode(chr3));while(i<input.length);return output}};return obj}(),MD5=function(){var safe_add=function(x,y){var lsw=(65535&x)+(65535&y),msw=(x>>16)+(y>>16)+(lsw>>16);return msw<<16|65535&lsw},bit_rol=function(num,cnt){return num<<cnt|num>>>32-cnt},str2binl=function(str){for(var bin=[],i=0;i<8*str.length;i+=8)bin[i>>5]|=(255&str.charCodeAt(i/8))<<i%32;return bin},binl2str=function(bin){for(var str="",i=0;i<32*bin.length;i+=8)str+=String.fromCharCode(bin[i>>5]>>>i%32&255);return str},binl2hex=function(binarray){for(var hex_tab="0123456789abcdef",str="",i=0;i<4*binarray.length;i++)str+=hex_tab.charAt(binarray[i>>2]>>i%4*8+4&15)+hex_tab.charAt(binarray[i>>2]>>i%4*8&15);return str},md5_cmn=function(q,a,b,x,s,t){return safe_add(bit_rol(safe_add(safe_add(a,q),safe_add(x,t)),s),b)},md5_ff=function(a,b,c,d,x,s,t){return md5_cmn(b&c|~b&d,a,b,x,s,t)},md5_gg=function(a,b,c,d,x,s,t){return md5_cmn(b&d|c&~d,a,b,x,s,t)},md5_hh=function(a,b,c,d,x,s,t){return md5_cmn(b^c^d,a,b,x,s,t)},md5_ii=function(a,b,c,d,x,s,t){return md5_cmn(c^(b|~d),a,b,x,s,t)},core_md5=function(x,len){x[len>>5]|=128<<len%32,x[(len+64>>>9<<4)+14]=len;for(var olda,oldb,oldc,oldd,a=1732584193,b=-271733879,c=-1732584194,d=271733878,i=0;i<x.length;i+=16)olda=a,oldb=b,oldc=c,oldd=d,a=md5_ff(a,b,c,d,x[i+0],7,-680876936),d=md5_ff(d,a,b,c,x[i+1],12,-389564586),c=md5_ff(c,d,a,b,x[i+2],17,606105819),b=md5_ff(b,c,d,a,x[i+3],22,-1044525330),a=md5_ff(a,b,c,d,x[i+4],7,-176418897),d=md5_ff(d,a,b,c,x[i+5],12,1200080426),c=md5_ff(c,d,a,b,x[i+6],17,-1473231341),b=md5_ff(b,c,d,a,x[i+7],22,-45705983),a=md5_ff(a,b,c,d,x[i+8],7,1770035416),d=md5_ff(d,a,b,c,x[i+9],12,-1958414417),c=md5_ff(c,d,a,b,x[i+10],17,-42063),b=md5_ff(b,c,d,a,x[i+11],22,-1990404162),a=md5_ff(a,b,c,d,x[i+12],7,1804603682),d=md5_ff(d,a,b,c,x[i+13],12,-40341101),c=md5_ff(c,d,a,b,x[i+14],17,-1502002290),b=md5_ff(b,c,d,a,x[i+15],22,1236535329),a=md5_gg(a,b,c,d,x[i+1],5,-165796510),d=md5_gg(d,a,b,c,x[i+6],9,-1069501632),c=md5_gg(c,d,a,b,x[i+11],14,643717713),b=md5_gg(b,c,d,a,x[i+0],20,-373897302),a=md5_gg(a,b,c,d,x[i+5],5,-701558691),d=md5_gg(d,a,b,c,x[i+10],9,38016083),c=md5_gg(c,d,a,b,x[i+15],14,-660478335),b=md5_gg(b,c,d,a,x[i+4],20,-405537848),a=md5_gg(a,b,c,d,x[i+9],5,568446438),d=md5_gg(d,a,b,c,x[i+14],9,-1019803690),c=md5_gg(c,d,a,b,x[i+3],14,-187363961),b=md5_gg(b,c,d,a,x[i+8],20,1163531501),a=md5_gg(a,b,c,d,x[i+13],5,-1444681467),d=md5_gg(d,a,b,c,x[i+2],9,-51403784),c=md5_gg(c,d,a,b,x[i+7],14,1735328473),b=md5_gg(b,c,d,a,x[i+12],20,-1926607734),a=md5_hh(a,b,c,d,x[i+5],4,-378558),d=md5_hh(d,a,b,c,x[i+8],11,-2022574463),c=md5_hh(c,d,a,b,x[i+11],16,1839030562),b=md5_hh(b,c,d,a,x[i+14],23,-35309556),a=md5_hh(a,b,c,d,x[i+1],4,-1530992060),d=md5_hh(d,a,b,c,x[i+4],11,1272893353),c=md5_hh(c,d,a,b,x[i+7],16,-155497632),b=md5_hh(b,c,d,a,x[i+10],23,-1094730640),a=md5_hh(a,b,c,d,x[i+13],4,681279174),d=md5_hh(d,a,b,c,x[i+0],11,-358537222),c=md5_hh(c,d,a,b,x[i+3],16,-722521979),b=md5_hh(b,c,d,a,x[i+6],23,76029189),a=md5_hh(a,b,c,d,x[i+9],4,-640364487),d=md5_hh(d,a,b,c,x[i+12],11,-421815835),c=md5_hh(c,d,a,b,x[i+15],16,530742520),b=md5_hh(b,c,d,a,x[i+2],23,-995338651),a=md5_ii(a,b,c,d,x[i+0],6,-198630844),d=md5_ii(d,a,b,c,x[i+7],10,1126891415),c=md5_ii(c,d,a,b,x[i+14],15,-1416354905),b=md5_ii(b,c,d,a,x[i+5],21,-57434055),a=md5_ii(a,b,c,d,x[i+12],6,1700485571),d=md5_ii(d,a,b,c,x[i+3],10,-1894986606),c=md5_ii(c,d,a,b,x[i+10],15,-1051523),b=md5_ii(b,c,d,a,x[i+1],21,-2054922799),a=md5_ii(a,b,c,d,x[i+8],6,1873313359),d=md5_ii(d,a,b,c,x[i+15],10,-30611744),c=md5_ii(c,d,a,b,x[i+6],15,-1560198380),b=md5_ii(b,c,d,a,x[i+13],21,1309151649),a=md5_ii(a,b,c,d,x[i+4],6,-145523070),d=md5_ii(d,a,b,c,x[i+11],10,-1120210379),c=md5_ii(c,d,a,b,x[i+2],15,718787259),b=md5_ii(b,c,d,a,x[i+9],21,-343485551),a=safe_add(a,olda),b=safe_add(b,oldb),c=safe_add(c,oldc),d=safe_add(d,oldd);return[a,b,c,d]},obj={hexdigest:function(s){return binl2hex(core_md5(str2binl(s),8*s.length))},hash:function(s){return binl2str(core_md5(str2binl(s),8*s.length))}};return obj}();Function.prototype.bind||(Function.prototype.bind=function(obj){var func=this,_slice=Array.prototype.slice,_concat=Array.prototype.concat,_args=_slice.call(arguments,1);return function(){return func.apply(obj?obj:this,_concat.call(_args,_slice.call(arguments,0)))}}),Array.prototype.indexOf||(Array.prototype.indexOf=function(elt){var len=this.length,from=Number(arguments[1])||0;for(from=0>from?Math.ceil(from):Math.floor(from),0>from&&(from+=len);len>from;from++)if(from in this&&this[from]===elt)return from;return-1}),function(callback){function $build(name,attrs){return new Strophe.Builder(name,attrs)}function $msg(attrs){return new Strophe.Builder("message",attrs)}function $iq(attrs){return new Strophe.Builder("iq",attrs)}function $pres(attrs){return new Strophe.Builder("presence",attrs)}var Strophe;Strophe={VERSION:"1.1.3",NS:{HTTPBIND:"http://jabber.org/protocol/httpbind",BOSH:"urn:xmpp:xbosh",CLIENT:"jabber:client",AUTH:"jabber:iq:auth",ROSTER:"jabber:iq:roster",PROFILE:"jabber:iq:profile",DISCO_INFO:"http://jabber.org/protocol/disco#info",DISCO_ITEMS:"http://jabber.org/protocol/disco#items",MUC:"http://jabber.org/protocol/muc",SASL:"urn:ietf:params:xml:ns:xmpp-sasl",STREAM:"http://etherx.jabber.org/streams",BIND:"urn:ietf:params:xml:ns:xmpp-bind",SESSION:"urn:ietf:params:xml:ns:xmpp-session",VERSION:"jabber:iq:version",STANZAS:"urn:ietf:params:xml:ns:xmpp-stanzas",XHTML_IM:"http://jabber.org/protocol/xhtml-im",XHTML:"http://www.w3.org/1999/xhtml"},XHTML:{tags:["a","blockquote","br","cite","em","img","li","ol","p","span","strong","ul","body"],attributes:{a:["href"],blockquote:["style"],br:[],cite:["style"],em:[],img:["src","alt","style","height","width"],li:["style"],ol:["style"],p:["style"],span:["style"],strong:[],ul:["style"],body:[]},css:["background-color","color","font-family","font-size","font-style","font-weight","margin-left","margin-right","text-align","text-decoration"],validTag:function(tag){for(var i=0;i<Strophe.XHTML.tags.length;i++)if(tag==Strophe.XHTML.tags[i])return!0;return!1},validAttribute:function(tag,attribute){if("undefined"!=typeof Strophe.XHTML.attributes[tag]&&Strophe.XHTML.attributes[tag].length>0)for(var i=0;i<Strophe.XHTML.attributes[tag].length;i++)if(attribute==Strophe.XHTML.attributes[tag][i])return!0;return!1},validCSS:function(style){for(var i=0;i<Strophe.XHTML.css.length;i++)if(style==Strophe.XHTML.css[i])return!0;return!1}},Status:{ERROR:0,CONNECTING:1,CONNFAIL:2,AUTHENTICATING:3,AUTHFAIL:4,CONNECTED:5,DISCONNECTED:6,DISCONNECTING:7,ATTACHED:8},LogLevel:{DEBUG:0,INFO:1,WARN:2,ERROR:3,FATAL:4},ElementType:{NORMAL:1,TEXT:3,CDATA:4,FRAGMENT:11},TIMEOUT:1.1,SECONDARY_TIMEOUT:.1,addNamespace:function(name,value){Strophe.NS[name]=value},forEachChild:function(elem,elemName,func){var i,childNode;for(i=0;i<elem.childNodes.length;i++)childNode=elem.childNodes[i],childNode.nodeType!=Strophe.ElementType.NORMAL||elemName&&!this.isTagEqual(childNode,elemName)||func(childNode)},isTagEqual:function(el,name){return el.tagName.toLowerCase()==name.toLowerCase()},_xmlGenerator:null,_makeGenerator:function(){var doc;return void 0===document.implementation.createDocument||document.implementation.createDocument&&document.documentMode&&document.documentMode<10?(doc=this._getIEXmlDom(),doc.appendChild(doc.createElement("strophe"))):doc=document.implementation.createDocument("jabber:client","strophe",null),doc},xmlGenerator:function(){return Strophe._xmlGenerator||(Strophe._xmlGenerator=Strophe._makeGenerator()),Strophe._xmlGenerator},_getIEXmlDom:function(){for(var doc=null,docStrings=["Msxml2.DOMDocument.6.0","Msxml2.DOMDocument.5.0","Msxml2.DOMDocument.4.0","MSXML2.DOMDocument.3.0","MSXML2.DOMDocument","MSXML.DOMDocument","Microsoft.XMLDOM"],d=0;d<docStrings.length&&null===doc;d++)try{doc=new ActiveXObject(docStrings[d])}catch(e){doc=null}return doc},xmlElement:function(name){if(!name)return null;var a,i,k,node=Strophe.xmlGenerator().createElement(name);for(a=1;a<arguments.length;a++)if(arguments[a])if("string"==typeof arguments[a]||"number"==typeof arguments[a])node.appendChild(Strophe.xmlTextNode(arguments[a]));else if("object"==typeof arguments[a]&&"function"==typeof arguments[a].sort)for(i=0;i<arguments[a].length;i++)"object"==typeof arguments[a][i]&&"function"==typeof arguments[a][i].sort&&node.setAttribute(arguments[a][i][0],arguments[a][i][1]);else if("object"==typeof arguments[a])for(k in arguments[a])arguments[a].hasOwnProperty(k)&&node.setAttribute(k,arguments[a][k]);return node},xmlescape:function(text){return text=text.replace(/\&/g,"&amp;"),text=text.replace(/</g,"&lt;"),text=text.replace(/>/g,"&gt;"),text=text.replace(/'/g,"&apos;"),text=text.replace(/"/g,"&quot;")},xmlunescape:function(text){return text=text.replace(/\&amp;/g,"&"),text=text.replace(/&lt;/g,"<"),text=text.replace(/&gt;/g,">"),text=text.replace(/&apos;/g,"'"),text=text.replace(/&quot;/g,'"')},xmlTextNode:function(text){return Strophe.xmlGenerator().createTextNode(text)},xmlHtmlNode:function(html){var node;if(window.DOMParser){var parser=new DOMParser;node=parser.parseFromString(html,"text/xml")}else node=new ActiveXObject("Microsoft.XMLDOM"),node.async="false",node.loadXML(html);return node},getText:function(elem){if(!elem)return null;var str="";0===elem.childNodes.length&&elem.nodeType==Strophe.ElementType.TEXT&&(str+=elem.nodeValue);for(var i=0;i<elem.childNodes.length;i++)elem.childNodes[i].nodeType==Strophe.ElementType.TEXT&&(str+=elem.childNodes[i].nodeValue);return Strophe.xmlescape(str)},copyElement:function(elem){var i,el;if(elem.nodeType==Strophe.ElementType.NORMAL){for(el=Strophe.xmlElement(elem.tagName),i=0;i<elem.attributes.length;i++)el.setAttribute(elem.attributes[i].nodeName.toLowerCase(),elem.attributes[i].value);for(i=0;i<elem.childNodes.length;i++)el.appendChild(Strophe.copyElement(elem.childNodes[i]))}else elem.nodeType==Strophe.ElementType.TEXT&&(el=Strophe.xmlGenerator().createTextNode(elem.nodeValue));return el},createHtml:function(elem){var i,el,j,tag,attribute,value,css,cssAttrs,attr,cssName,cssValue;if(elem.nodeType==Strophe.ElementType.NORMAL)if(tag=elem.nodeName.toLowerCase(),Strophe.XHTML.validTag(tag))try{for(el=Strophe.xmlElement(tag),i=0;i<Strophe.XHTML.attributes[tag].length;i++)if(attribute=Strophe.XHTML.attributes[tag][i],value=elem.getAttribute(attribute),"undefined"!=typeof value&&null!==value&&""!==value&&value!==!1&&0!==value)if("style"==attribute&&"object"==typeof value&&"undefined"!=typeof value.cssText&&(value=value.cssText),"style"==attribute){for(css=[],cssAttrs=value.split(";"),j=0;j<cssAttrs.length;j++)attr=cssAttrs[j].split(":"),cssName=attr[0].replace(/^\s*/,"").replace(/\s*$/,"").toLowerCase(),Strophe.XHTML.validCSS(cssName)&&(cssValue=attr[1].replace(/^\s*/,"").replace(/\s*$/,""),css.push(cssName+": "+cssValue));css.length>0&&(value=css.join("; "),el.setAttribute(attribute,value))}else el.setAttribute(attribute,value);for(i=0;i<elem.childNodes.length;i++)el.appendChild(Strophe.createHtml(elem.childNodes[i]))}catch(e){el=Strophe.xmlTextNode("")}else for(el=Strophe.xmlGenerator().createDocumentFragment(),i=0;i<elem.childNodes.length;i++)el.appendChild(Strophe.createHtml(elem.childNodes[i]));else if(elem.nodeType==Strophe.ElementType.FRAGMENT)for(el=Strophe.xmlGenerator().createDocumentFragment(),i=0;i<elem.childNodes.length;i++)el.appendChild(Strophe.createHtml(elem.childNodes[i]));else elem.nodeType==Strophe.ElementType.TEXT&&(el=Strophe.xmlTextNode(elem.nodeValue));return el},escapeNode:function(node){return node.replace(/^\s+|\s+$/g,"").replace(/\\/g,"\\5c").replace(/ /g,"\\20").replace(/\"/g,"\\22").replace(/\&/g,"\\26").replace(/\'/g,"\\27").replace(/\//g,"\\2f").replace(/:/g,"\\3a").replace(/</g,"\\3c").replace(/>/g,"\\3e").replace(/@/g,"\\40")},unescapeNode:function(node){return node.replace(/\\20/g," ").replace(/\\22/g,'"').replace(/\\26/g,"&").replace(/\\27/g,"'").replace(/\\2f/g,"/").replace(/\\3a/g,":").replace(/\\3c/g,"<").replace(/\\3e/g,">").replace(/\\40/g,"@").replace(/\\5c/g,"\\")},getNodeFromJid:function(jid){return jid.indexOf("@")<0?null:jid.split("@")[0]},getDomainFromJid:function(jid){var bare=Strophe.getBareJidFromJid(jid);if(bare.indexOf("@")<0)return bare;var parts=bare.split("@");return parts.splice(0,1),parts.join("@")},getResourceFromJid:function(jid){var s=jid.split("/");return s.length<2?null:(s.splice(0,1),s.join("/"))},getBareJidFromJid:function(jid){return jid?jid.split("/")[0]:null},log:function(){},debug:function(msg){this.log(this.LogLevel.DEBUG,msg)},info:function(msg){this.log(this.LogLevel.INFO,msg)},warn:function(msg){this.log(this.LogLevel.WARN,msg)},error:function(msg){this.log(this.LogLevel.ERROR,msg)},fatal:function(msg){this.log(this.LogLevel.FATAL,msg)},serialize:function(elem){var result;if(!elem)return null;"function"==typeof elem.tree&&(elem=elem.tree());var i,child,nodeName=elem.nodeName;for(elem.getAttribute("_realname")&&(nodeName=elem.getAttribute("_realname")),result="<"+nodeName,i=0;i<elem.attributes.length;i++)"_realname"!=elem.attributes[i].nodeName&&(result+=" "+elem.attributes[i].nodeName.toLowerCase()+"='"+elem.attributes[i].value.replace(/&/g,"&amp;").replace(/\'/g,"&apos;").replace(/>/g,"&gt;").replace(/</g,"&lt;")+"'");if(elem.childNodes.length>0){for(result+=">",i=0;i<elem.childNodes.length;i++)switch(child=elem.childNodes[i],child.nodeType){case Strophe.ElementType.NORMAL:result+=Strophe.serialize(child);break;case Strophe.ElementType.TEXT:result+=Strophe.xmlescape(child.nodeValue);break;case Strophe.ElementType.CDATA:result+="<![CDATA["+child.nodeValue+"]]>"}result+="</"+nodeName+">"}else result+="/>";return result},_requestId:0,_connectionPlugins:{},addConnectionPlugin:function(name,ptype){Strophe._connectionPlugins[name]=ptype}},Strophe.Builder=function(name,attrs){("presence"==name||"message"==name||"iq"==name)&&(attrs&&!attrs.xmlns?attrs.xmlns=Strophe.NS.CLIENT:attrs||(attrs={xmlns:Strophe.NS.CLIENT})),this.nodeTree=Strophe.xmlElement(name,attrs),this.node=this.nodeTree},Strophe.Builder.prototype={tree:function(){return this.nodeTree},toString:function(){return Strophe.serialize(this.nodeTree)},up:function(){return this.node=this.node.parentNode,this},attrs:function(moreattrs){for(var k in moreattrs)moreattrs.hasOwnProperty(k)&&this.node.setAttribute(k,moreattrs[k]);return this},c:function(name,attrs,text){var child=Strophe.xmlElement(name,attrs,text);return this.node.appendChild(child),text||(this.node=child),this},cnode:function(elem){var impNode,xmlGen=Strophe.xmlGenerator();try{impNode=void 0!==xmlGen.importNode}catch(e){impNode=!1}var newElem=impNode?xmlGen.importNode(elem,!0):Strophe.copyElement(elem);return this.node.appendChild(newElem),this.node=newElem,this},t:function(text){var child=Strophe.xmlTextNode(text);return this.node.appendChild(child),this},h:function(html){var fragment=document.createElement("body");fragment.innerHTML=html;for(var xhtml=Strophe.createHtml(fragment);xhtml.childNodes.length>0;)this.node.appendChild(xhtml.childNodes[0]);return this}},Strophe.Handler=function(handler,ns,name,type,id,from,options){this.handler=handler,this.ns=ns,this.name=name,this.type=type,this.id=id,this.options=options||{matchBare:!1},this.options.matchBare||(this.options.matchBare=!1),this.from=this.options.matchBare?from?Strophe.getBareJidFromJid(from):null:from,this.user=!0},Strophe.Handler.prototype={isMatch:function(elem){var nsMatch,from=null;if(from=this.options.matchBare?Strophe.getBareJidFromJid(elem.getAttribute("from")):elem.getAttribute("from"),nsMatch=!1,this.ns){var that=this;Strophe.forEachChild(elem,null,function(elem){elem.getAttribute("xmlns")==that.ns&&(nsMatch=!0)}),nsMatch=nsMatch||elem.getAttribute("xmlns")==this.ns}else nsMatch=!0;return!nsMatch||this.name&&!Strophe.isTagEqual(elem,this.name)||this.type&&elem.getAttribute("type")!=this.type||this.id&&elem.getAttribute("id")!=this.id||this.from&&from!=this.from?!1:!0},run:function(elem){var result=null;try{result=this.handler(elem)}catch(e){throw e.sourceURL?Strophe.fatal("error: "+this.handler+" "+e.sourceURL+":"+e.line+" - "+e.name+": "+e.message):e.fileName?("undefined"!=typeof console&&(console.trace(),console.error(this.handler," - error - ",e,e.message)),Strophe.fatal("error: "+this.handler+" "+e.fileName+":"+e.lineNumber+" - "+e.name+": "+e.message)):Strophe.fatal("error: "+e.message+"\n"+e.stack),e}return result},toString:function(){return"{Handler: "+this.handler+"("+this.name+","+this.id+","+this.ns+")}"}},Strophe.TimedHandler=function(period,handler){this.period=period,this.handler=handler,this.lastCalled=(new Date).getTime(),this.user=!0},Strophe.TimedHandler.prototype={run:function(){return this.lastCalled=(new Date).getTime(),this.handler()},reset:function(){this.lastCalled=(new Date).getTime()},toString:function(){return"{TimedHandler: "+this.handler+"("+this.period+")}"}},Strophe.Connection=function(service,options){this.service=service,this.options=options||{};var proto=this.options.protocol||"";this._proto=0===service.indexOf("ws:")||0===service.indexOf("wss:")||0===proto.indexOf("ws")?new Strophe.Websocket(this):new Strophe.Bosh(this),this.jid="",this.domain=null,this.features=null,this._sasl_data={},this.do_session=!1,this.do_bind=!1,this.timedHandlers=[],this.handlers=[],this.removeTimeds=[],this.removeHandlers=[],this.addTimeds=[],this.addHandlers=[],this._authentication={},this._idleTimeout=null,this._disconnectTimeout=null,this.do_authentication=!0,this.authenticated=!1,this.disconnecting=!1,this.connected=!1,this.errors=0,this.paused=!1,this._data=[],this._uniqueId=0,this._sasl_success_handler=null,this._sasl_failure_handler=null,this._sasl_challenge_handler=null,this.maxRetries=5,this._idleTimeout=setTimeout(this._onIdle.bind(this),100);for(var k in Strophe._connectionPlugins)if(Strophe._connectionPlugins.hasOwnProperty(k)){var ptype=Strophe._connectionPlugins[k],F=function(){};F.prototype=ptype,this[k]=new F,this[k].init(this)}},Strophe.Connection.prototype={reset:function(){this._proto._reset(),this.do_session=!1,this.do_bind=!1,this.timedHandlers=[],this.handlers=[],this.removeTimeds=[],this.removeHandlers=[],this.addTimeds=[],this.addHandlers=[],this._authentication={},this.authenticated=!1,this.disconnecting=!1,this.connected=!1,this.errors=0,this._requests=[],this._uniqueId=0},pause:function(){this.paused=!0},resume:function(){this.paused=!1},getUniqueId:function(suffix){return"string"==typeof suffix||"number"==typeof suffix?++this._uniqueId+":"+suffix:++this._uniqueId+""},connect:function(jid,pass,callback,wait,hold,route){this.jid=jid,this.authzid=Strophe.getBareJidFromJid(this.jid),this.authcid=Strophe.getNodeFromJid(this.jid),this.pass=pass,this.servtype="xmpp",this.connect_callback=callback,this.disconnecting=!1,this.connected=!1,this.authenticated=!1,this.errors=0,this.domain=Strophe.getDomainFromJid(this.jid),this._changeConnectStatus(Strophe.Status.CONNECTING,null),this._proto._connect(wait,hold,route)},attach:function(jid,sid,rid,callback,wait,hold,wind){this._proto._attach(jid,sid,rid,callback,wait,hold,wind)},xmlInput:function(){},xmlOutput:function(){},rawInput:function(){},rawOutput:function(){},send:function(elem){if(null!==elem){if("function"==typeof elem.sort)for(var i=0;i<elem.length;i++)this._queueData(elem[i]);else this._queueData("function"==typeof elem.tree?elem.tree():elem);this._proto._send()}},flush:function(){clearTimeout(this._idleTimeout),this._onIdle()},sendIQ:function(elem,callback,errback,timeout){var timeoutHandler=null,that=this;"function"==typeof elem.tree&&(elem=elem.tree());var id=elem.getAttribute("id");id||(id=this.getUniqueId("sendIQ"),elem.setAttribute("id",id));var handler=this.addHandler(function(stanza){timeoutHandler&&that.deleteTimedHandler(timeoutHandler);var iqtype=stanza.getAttribute("type");if("result"==iqtype)callback&&callback(stanza);else{if("error"!=iqtype)throw{name:"StropheError",message:"Got bad IQ type of "+iqtype};errback&&errback(stanza)}},null,"iq",null,id);return timeout&&(timeoutHandler=this.addTimedHandler(timeout,function(){return that.deleteHandler(handler),errback&&errback(null),!1})),this.send(elem),id},_queueData:function(element){if(null===element||!element.tagName||!element.childNodes)throw{name:"StropheError",message:"Cannot queue non-DOMElement."};this._data.push(element)},_sendRestart:function(){this._data.push("restart"),this._proto._sendRestart(),this._idleTimeout=setTimeout(this._onIdle.bind(this),100)},addTimedHandler:function(period,handler){var thand=new Strophe.TimedHandler(period,handler);return this.addTimeds.push(thand),thand},deleteTimedHandler:function(handRef){this.removeTimeds.push(handRef)},addHandler:function(handler,ns,name,type,id,from,options){var hand=new Strophe.Handler(handler,ns,name,type,id,from,options);return this.addHandlers.push(hand),hand},deleteHandler:function(handRef){this.removeHandlers.push(handRef)},disconnect:function(reason){if(this._changeConnectStatus(Strophe.Status.DISCONNECTING,reason),Strophe.info("Disconnect was called because: "+reason),this.connected){var pres=!1;this.disconnecting=!0,this.authenticated&&(pres=$pres({xmlns:Strophe.NS.CLIENT,type:"unavailable"})),this._disconnectTimeout=this._addSysTimedHandler(3e3,this._onDisconnectTimeout.bind(this)),this._proto._disconnect(pres)}},_changeConnectStatus:function(status,condition){for(var k in Strophe._connectionPlugins)if(Strophe._connectionPlugins.hasOwnProperty(k)){var plugin=this[k];if(plugin.statusChanged)try{plugin.statusChanged(status,condition)}catch(err){Strophe.error(""+k+" plugin caused an exception changing status: "+err)}}if(this.connect_callback)try{this.connect_callback(status,condition)}catch(e){Strophe.error("User connection callback caused an exception: "+e)}},_doDisconnect:function(){null!==this._disconnectTimeout&&(this.deleteTimedHandler(this._disconnectTimeout),this._disconnectTimeout=null),Strophe.info("_doDisconnect was called"),this._proto._doDisconnect(),this.authenticated=!1,this.disconnecting=!1,this.handlers=[],this.timedHandlers=[],this.removeTimeds=[],this.removeHandlers=[],this.addTimeds=[],this.addHandlers=[],this._changeConnectStatus(Strophe.Status.DISCONNECTED,null),this.connected=!1},_dataRecv:function(req,raw){Strophe.info("_dataRecv called");var elem=this._proto._reqToData(req);if(null!==elem){this.xmlInput!==Strophe.Connection.prototype.xmlInput&&this.xmlInput(elem.nodeName===this._proto.strip&&elem.childNodes.length?elem.childNodes[0]:elem),this.rawInput!==Strophe.Connection.prototype.rawInput&&this.rawInput(raw?raw:Strophe.serialize(elem));for(var i,hand;this.removeHandlers.length>0;)hand=this.removeHandlers.pop(),i=this.handlers.indexOf(hand),i>=0&&this.handlers.splice(i,1);for(;this.addHandlers.length>0;)this.handlers.push(this.addHandlers.pop());if(this.disconnecting&&this._proto._emptyQueue())return void this._doDisconnect();var cond,conflict,typ=elem.getAttribute("type");if(null!==typ&&"terminate"==typ){if(this.disconnecting)return;return cond=elem.getAttribute("condition"),conflict=elem.getElementsByTagName("conflict"),null!==cond?("remote-stream-error"==cond&&conflict.length>0&&(cond="conflict"),this._changeConnectStatus(Strophe.Status.CONNFAIL,cond)):this._changeConnectStatus(Strophe.Status.CONNFAIL,"unknown"),void this.disconnect("unknown stream-error")}var that=this;Strophe.forEachChild(elem,null,function(child){var i,newList;for(newList=that.handlers,that.handlers=[],i=0;i<newList.length;i++){var hand=newList[i];try{!hand.isMatch(child)||!that.authenticated&&hand.user?that.handlers.push(hand):hand.run(child)&&that.handlers.push(hand)}catch(e){Strophe.warn("Removing Strophe handlers due to uncaught exception: "+e.message)}}})}},mechanisms:{},_connect_cb:function(req,_callback,raw){Strophe.info("_connect_cb was called"),this.connected=!0;var bodyWrap=this._proto._reqToData(req);if(bodyWrap){this.xmlInput!==Strophe.Connection.prototype.xmlInput&&this.xmlInput(bodyWrap.nodeName===this._proto.strip&&bodyWrap.childNodes.length?bodyWrap.childNodes[0]:bodyWrap),this.rawInput!==Strophe.Connection.prototype.rawInput&&this.rawInput(raw?raw:Strophe.serialize(bodyWrap));var conncheck=this._proto._connect_cb(bodyWrap);if(conncheck!==Strophe.Status.CONNFAIL){this._authentication.sasl_scram_sha1=!1,this._authentication.sasl_plain=!1,this._authentication.sasl_digest_md5=!1,this._authentication.sasl_anonymous=!1,this._authentication.legacy_auth=!1;var hasFeatures=bodyWrap.getElementsByTagName("stream:features").length>0;hasFeatures||(hasFeatures=bodyWrap.getElementsByTagName("features").length>0);var i,mech,mechanisms=bodyWrap.getElementsByTagName("mechanism"),matched=[],found_authentication=!1;if(!hasFeatures)return void this._proto._no_auth_received(_callback);if(mechanisms.length>0)for(i=0;i<mechanisms.length;i++)mech=Strophe.getText(mechanisms[i]),this.mechanisms[mech]&&matched.push(this.mechanisms[mech]);return this._authentication.legacy_auth=bodyWrap.getElementsByTagName("auth").length>0,(found_authentication=this._authentication.legacy_auth||matched.length>0)?void(this.do_authentication!==!1&&this.authenticate(matched)):void this._proto._no_auth_received(_callback)}}},authenticate:function(matched){var i;for(i=0;i<matched.length-1;++i){for(var higher=i,j=i+1;j<matched.length;++j)matched[j].prototype.priority>matched[higher].prototype.priority&&(higher=j);if(higher!=i){var swap=matched[i];matched[i]=matched[higher],matched[higher]=swap}}var mechanism_found=!1;for(i=0;i<matched.length;++i)if(matched[i].test(this)){this._sasl_success_handler=this._addSysHandler(this._sasl_success_cb.bind(this),null,"success",null,null),this._sasl_failure_handler=this._addSysHandler(this._sasl_failure_cb.bind(this),null,"failure",null,null),this._sasl_challenge_handler=this._addSysHandler(this._sasl_challenge_cb.bind(this),null,"challenge",null,null),this._sasl_mechanism=new matched[i],this._sasl_mechanism.onStart(this);var request_auth_exchange=$build("auth",{xmlns:Strophe.NS.SASL,mechanism:this._sasl_mechanism.name});if(this._sasl_mechanism.isClientFirst){var response=this._sasl_mechanism.onChallenge(this,null);request_auth_exchange.t(Base64.encode(response))}this.send(request_auth_exchange.tree()),mechanism_found=!0;break}mechanism_found||(null===Strophe.getNodeFromJid(this.jid)?(this._changeConnectStatus(Strophe.Status.CONNFAIL,"x-strophe-bad-non-anon-jid"),this.disconnect("x-strophe-bad-non-anon-jid")):(this._changeConnectStatus(Strophe.Status.AUTHENTICATING,null),this._addSysHandler(this._auth1_cb.bind(this),null,null,null,"_auth_1"),this.send($iq({type:"get",to:this.domain,id:"_auth_1"}).c("query",{xmlns:Strophe.NS.AUTH}).c("username",{}).t(Strophe.getNodeFromJid(this.jid)).tree())))},_sasl_challenge_cb:function(elem){var challenge=Base64.decode(Strophe.getText(elem)),response=this._sasl_mechanism.onChallenge(this,challenge),stanza=$build("response",{xmlns:Strophe.NS.SASL});return""!==response&&stanza.t(Base64.encode(response)),this.send(stanza.tree()),!0},_auth1_cb:function(){var iq=$iq({type:"set",id:"_auth_2"}).c("query",{xmlns:Strophe.NS.AUTH}).c("username",{}).t(Strophe.getNodeFromJid(this.jid)).up().c("password").t(this.pass);return Strophe.getResourceFromJid(this.jid)||(this.jid=Strophe.getBareJidFromJid(this.jid)+"/strophe"),iq.up().c("resource",{}).t(Strophe.getResourceFromJid(this.jid)),this._addSysHandler(this._auth2_cb.bind(this),null,null,null,"_auth_2"),this.send(iq.tree()),!1},_sasl_success_cb:function(elem){if(this._sasl_data["server-signature"]){var serverSignature,success=Base64.decode(Strophe.getText(elem)),attribMatch=/([a-z]+)=([^,]+)(,|$)/,matches=success.match(attribMatch);if("v"==matches[1]&&(serverSignature=matches[2]),serverSignature!=this._sasl_data["server-signature"])return this.deleteHandler(this._sasl_failure_handler),this._sasl_failure_handler=null,this._sasl_challenge_handler&&(this.deleteHandler(this._sasl_challenge_handler),this._sasl_challenge_handler=null),this._sasl_data={},this._sasl_failure_cb(null)}return Strophe.info("SASL authentication succeeded."),this._sasl_mechanism&&this._sasl_mechanism.onSuccess(),this.deleteHandler(this._sasl_failure_handler),this._sasl_failure_handler=null,this._sasl_challenge_handler&&(this.deleteHandler(this._sasl_challenge_handler),this._sasl_challenge_handler=null),this._addSysHandler(this._sasl_auth1_cb.bind(this),null,"stream:features",null,null),this._sendRestart(),!1},_sasl_auth1_cb:function(elem){this.features=elem;var i,child;for(i=0;i<elem.childNodes.length;i++)child=elem.childNodes[i],"bind"==child.nodeName&&(this.do_bind=!0),"session"==child.nodeName&&(this.do_session=!0);if(!this.do_bind)return this._changeConnectStatus(Strophe.Status.AUTHFAIL,null),!1;this._addSysHandler(this._sasl_bind_cb.bind(this),null,null,null,"_bind_auth_2");var resource=Strophe.getResourceFromJid(this.jid);return this.send(resource?$iq({type:"set",id:"_bind_auth_2"}).c("bind",{xmlns:Strophe.NS.BIND}).c("resource",{}).t(resource).tree():$iq({type:"set",id:"_bind_auth_2"}).c("bind",{xmlns:Strophe.NS.BIND}).tree()),!1
},_sasl_bind_cb:function(elem){if("error"==elem.getAttribute("type")){Strophe.info("SASL binding failed.");var condition,conflict=elem.getElementsByTagName("conflict");return conflict.length>0&&(condition="conflict"),this._changeConnectStatus(Strophe.Status.AUTHFAIL,condition),!1}var jidNode,bind=elem.getElementsByTagName("bind");return bind.length>0?(jidNode=bind[0].getElementsByTagName("jid"),void(jidNode.length>0&&(this.jid=Strophe.getText(jidNode[0]),this.do_session?(this._addSysHandler(this._sasl_session_cb.bind(this),null,null,null,"_session_auth_2"),this.send($iq({type:"set",id:"_session_auth_2"}).c("session",{xmlns:Strophe.NS.SESSION}).tree())):(this.authenticated=!0,this._changeConnectStatus(Strophe.Status.CONNECTED,null))))):(Strophe.info("SASL binding failed."),this._changeConnectStatus(Strophe.Status.AUTHFAIL,null),!1)},_sasl_session_cb:function(elem){if("result"==elem.getAttribute("type"))this.authenticated=!0,this._changeConnectStatus(Strophe.Status.CONNECTED,null);else if("error"==elem.getAttribute("type"))return Strophe.info("Session creation failed."),this._changeConnectStatus(Strophe.Status.AUTHFAIL,null),!1;return!1},_sasl_failure_cb:function(){return this._sasl_success_handler&&(this.deleteHandler(this._sasl_success_handler),this._sasl_success_handler=null),this._sasl_challenge_handler&&(this.deleteHandler(this._sasl_challenge_handler),this._sasl_challenge_handler=null),this._sasl_mechanism&&this._sasl_mechanism.onFailure(),this._changeConnectStatus(Strophe.Status.AUTHFAIL,null),!1},_auth2_cb:function(elem){return"result"==elem.getAttribute("type")?(this.authenticated=!0,this._changeConnectStatus(Strophe.Status.CONNECTED,null)):"error"==elem.getAttribute("type")&&(this._changeConnectStatus(Strophe.Status.AUTHFAIL,null),this.disconnect("authentication failed")),!1},_addSysTimedHandler:function(period,handler){var thand=new Strophe.TimedHandler(period,handler);return thand.user=!1,this.addTimeds.push(thand),thand},_addSysHandler:function(handler,ns,name,type,id){var hand=new Strophe.Handler(handler,ns,name,type,id);return hand.user=!1,this.addHandlers.push(hand),hand},_onDisconnectTimeout:function(){return Strophe.info("_onDisconnectTimeout was called"),this._proto._onDisconnectTimeout(),this._doDisconnect(),!1},_onIdle:function(){for(var i,thand,since,newList;this.addTimeds.length>0;)this.timedHandlers.push(this.addTimeds.pop());for(;this.removeTimeds.length>0;)thand=this.removeTimeds.pop(),i=this.timedHandlers.indexOf(thand),i>=0&&this.timedHandlers.splice(i,1);var now=(new Date).getTime();for(newList=[],i=0;i<this.timedHandlers.length;i++)thand=this.timedHandlers[i],(this.authenticated||!thand.user)&&(since=thand.lastCalled+thand.period,0>=since-now?thand.run()&&newList.push(thand):newList.push(thand));this.timedHandlers=newList,clearTimeout(this._idleTimeout),this._proto._onIdle(),this.connected&&(this._idleTimeout=setTimeout(this._onIdle.bind(this),100))}},callback&&callback(Strophe,$build,$msg,$iq,$pres),Strophe.SASLMechanism=function(name,isClientFirst,priority){this.name=name,this.isClientFirst=isClientFirst,this.priority=priority},Strophe.SASLMechanism.prototype={test:function(){return!0},onStart:function(connection){this._connection=connection},onChallenge:function(){throw new Error("You should implement challenge handling!")},onFailure:function(){this._connection=null},onSuccess:function(){this._connection=null}},Strophe.SASLAnonymous=function(){},Strophe.SASLAnonymous.prototype=new Strophe.SASLMechanism("ANONYMOUS",!1,10),Strophe.SASLAnonymous.test=function(connection){return null===connection.authcid},Strophe.Connection.prototype.mechanisms[Strophe.SASLAnonymous.prototype.name]=Strophe.SASLAnonymous,Strophe.SASLPlain=function(){},Strophe.SASLPlain.prototype=new Strophe.SASLMechanism("PLAIN",!0,20),Strophe.SASLPlain.test=function(connection){return null!==connection.authcid},Strophe.SASLPlain.prototype.onChallenge=function(connection){var auth_str=connection.authzid;return auth_str+="\x00",auth_str+=connection.authcid,auth_str+="\x00",auth_str+=connection.pass},Strophe.Connection.prototype.mechanisms[Strophe.SASLPlain.prototype.name]=Strophe.SASLPlain,Strophe.SASLSHA1=function(){},Strophe.SASLSHA1.prototype=new Strophe.SASLMechanism("SCRAM-SHA-1",!0,40),Strophe.SASLSHA1.test=function(connection){return null!==connection.authcid},Strophe.SASLSHA1.prototype.onChallenge=function(connection,challenge,test_cnonce){var cnonce=test_cnonce||MD5.hexdigest(1234567890*Math.random()),auth_str="n="+connection.authcid;return auth_str+=",r=",auth_str+=cnonce,connection._sasl_data.cnonce=cnonce,connection._sasl_data["client-first-message-bare"]=auth_str,auth_str="n,,"+auth_str,this.onChallenge=function(connection,challenge){for(var nonce,salt,iter,Hi,U,U_old,i,k,clientKey,serverKey,clientSignature,responseText="c=biws,",authMessage=connection._sasl_data["client-first-message-bare"]+","+challenge+",",cnonce=connection._sasl_data.cnonce,attribMatch=/([a-z]+)=([^,]+)(,|$)/;challenge.match(attribMatch);){var matches=challenge.match(attribMatch);switch(challenge=challenge.replace(matches[0],""),matches[1]){case"r":nonce=matches[2];break;case"s":salt=matches[2];break;case"i":iter=matches[2]}}if(nonce.substr(0,cnonce.length)!==cnonce)return connection._sasl_data={},connection._sasl_failure_cb();for(responseText+="r="+nonce,authMessage+=responseText,salt=Base64.decode(salt),salt+="\x00\x00\x00",Hi=U_old=core_hmac_sha1(connection.pass,salt),i=1;iter>i;i++){for(U=core_hmac_sha1(connection.pass,binb2str(U_old)),k=0;5>k;k++)Hi[k]^=U[k];U_old=U}for(Hi=binb2str(Hi),clientKey=core_hmac_sha1(Hi,"Client Key"),serverKey=str_hmac_sha1(Hi,"Server Key"),clientSignature=core_hmac_sha1(str_sha1(binb2str(clientKey)),authMessage),connection._sasl_data["server-signature"]=b64_hmac_sha1(serverKey,authMessage),k=0;5>k;k++)clientKey[k]^=clientSignature[k];return responseText+=",p="+Base64.encode(binb2str(clientKey))}.bind(this),auth_str},Strophe.Connection.prototype.mechanisms[Strophe.SASLSHA1.prototype.name]=Strophe.SASLSHA1,Strophe.SASLMD5=function(){},Strophe.SASLMD5.prototype=new Strophe.SASLMechanism("DIGEST-MD5",!1,30),Strophe.SASLMD5.test=function(connection){return null!==connection.authcid},Strophe.SASLMD5.prototype._quote=function(str){return'"'+str.replace(/\\/g,"\\\\").replace(/"/g,'\\"')+'"'},Strophe.SASLMD5.prototype.onChallenge=function(connection,challenge,test_cnonce){for(var matches,attribMatch=/([a-z]+)=("[^"]+"|[^,"]+)(?:,|$)/,cnonce=test_cnonce||MD5.hexdigest(""+1234567890*Math.random()),realm="",host=null,nonce="",qop="";challenge.match(attribMatch);)switch(matches=challenge.match(attribMatch),challenge=challenge.replace(matches[0],""),matches[2]=matches[2].replace(/^"(.+)"$/,"$1"),matches[1]){case"realm":realm=matches[2];break;case"nonce":nonce=matches[2];break;case"qop":qop=matches[2];break;case"host":host=matches[2]}var digest_uri=connection.servtype+"/"+connection.domain;null!==host&&(digest_uri=digest_uri+"/"+host);var A1=MD5.hash(connection.authcid+":"+realm+":"+this._connection.pass)+":"+nonce+":"+cnonce,A2="AUTHENTICATE:"+digest_uri,responseText="";return responseText+="charset=utf-8,",responseText+="username="+this._quote(connection.authcid)+",",responseText+="realm="+this._quote(realm)+",",responseText+="nonce="+this._quote(nonce)+",",responseText+="nc=00000001,",responseText+="cnonce="+this._quote(cnonce)+",",responseText+="digest-uri="+this._quote(digest_uri)+",",responseText+="response="+MD5.hexdigest(MD5.hexdigest(A1)+":"+nonce+":00000001:"+cnonce+":auth:"+MD5.hexdigest(A2))+",",responseText+="qop=auth",this.onChallenge=function(){return""}.bind(this),responseText},Strophe.Connection.prototype.mechanisms[Strophe.SASLMD5.prototype.name]=Strophe.SASLMD5}(function(){window.Strophe=arguments[0],window.$build=arguments[1],window.$msg=arguments[2],window.$iq=arguments[3],window.$pres=arguments[4]}),Strophe.Request=function(elem,func,rid,sends){this.id=++Strophe._requestId,this.xmlData=elem,this.data=Strophe.serialize(elem),this.origFunc=func,this.func=func,this.rid=rid,this.date=0/0,this.sends=sends||0,this.abort=!1,this.dead=null,this.age=function(){if(!this.date)return 0;var now=new Date;return(now-this.date)/1e3},this.timeDead=function(){if(!this.dead)return 0;var now=new Date;return(now-this.dead)/1e3},this.xhr=this._newXHR()},Strophe.Request.prototype={getResponse:function(){var node=null;if(this.xhr.responseXML&&this.xhr.responseXML.documentElement){if(node=this.xhr.responseXML.documentElement,"parsererror"==node.tagName)throw Strophe.error("invalid response received"),Strophe.error("responseText: "+this.xhr.responseText),Strophe.error("responseXML: "+Strophe.serialize(this.xhr.responseXML)),"parsererror"}else this.xhr.responseText&&(Strophe.error("invalid response received"),Strophe.error("responseText: "+this.xhr.responseText),Strophe.error("responseXML: "+Strophe.serialize(this.xhr.responseXML)));return node},_newXHR:function(){var xhr=null;return window.XMLHttpRequest?(xhr=new XMLHttpRequest,xhr.overrideMimeType&&xhr.overrideMimeType("text/xml")):window.ActiveXObject&&(xhr=new ActiveXObject("Microsoft.XMLHTTP")),xhr.onreadystatechange=this.func.bind(null,this),xhr}},Strophe.Bosh=function(connection){this._conn=connection,this.rid=Math.floor(4294967295*Math.random()),this.sid=null,this.hold=1,this.wait=60,this.window=5,this._requests=[]},Strophe.Bosh.prototype={strip:null,_buildBody:function(){var bodyWrap=$build("body",{rid:this.rid++,xmlns:Strophe.NS.HTTPBIND});return null!==this.sid&&bodyWrap.attrs({sid:this.sid}),bodyWrap},_reset:function(){this.rid=Math.floor(4294967295*Math.random()),this.sid=null},_connect:function(wait,hold,route){this.wait=wait||this.wait,this.hold=hold||this.hold;var body=this._buildBody().attrs({to:this._conn.domain,"xml:lang":"en",wait:this.wait,hold:this.hold,content:"text/xml; charset=utf-8",ver:"1.6","xmpp:version":"1.0","xmlns:xmpp":Strophe.NS.BOSH});route&&body.attrs({route:route});var _connect_cb=this._conn._connect_cb;this._requests.push(new Strophe.Request(body.tree(),this._onRequestStateChange.bind(this,_connect_cb.bind(this._conn)),body.tree().getAttribute("rid"))),this._throttledRequestHandler()},_attach:function(jid,sid,rid,callback,wait,hold,wind){this._conn.jid=jid,this.sid=sid,this.rid=rid,this._conn.connect_callback=callback,this._conn.domain=Strophe.getDomainFromJid(this._conn.jid),this._conn.authenticated=!0,this._conn.connected=!0,this.wait=wait||this.wait,this.hold=hold||this.hold,this.window=wind||this.window,this._conn._changeConnectStatus(Strophe.Status.ATTACHED,null)},_connect_cb:function(bodyWrap){var cond,conflict,typ=bodyWrap.getAttribute("type");if(null!==typ&&"terminate"==typ)return Strophe.error("BOSH-Connection failed: "+cond),cond=bodyWrap.getAttribute("condition"),conflict=bodyWrap.getElementsByTagName("conflict"),null!==cond?("remote-stream-error"==cond&&conflict.length>0&&(cond="conflict"),this._conn._changeConnectStatus(Strophe.Status.CONNFAIL,cond)):this._conn._changeConnectStatus(Strophe.Status.CONNFAIL,"unknown"),this._conn._doDisconnect(),Strophe.Status.CONNFAIL;this.sid||(this.sid=bodyWrap.getAttribute("sid"));var wind=bodyWrap.getAttribute("requests");wind&&(this.window=parseInt(wind,10));var hold=bodyWrap.getAttribute("hold");hold&&(this.hold=parseInt(hold,10));var wait=bodyWrap.getAttribute("wait");wait&&(this.wait=parseInt(wait,10))},_disconnect:function(pres){this._sendTerminate(pres)},_doDisconnect:function(){this.sid=null,this.rid=Math.floor(4294967295*Math.random())},_emptyQueue:function(){return 0===this._requests.length},_hitError:function(reqStatus){this.errors++,Strophe.warn("request errored, status: "+reqStatus+", number of errors: "+this.errors),this.errors>4&&this._onDisconnectTimeout()},_no_auth_received:function(_callback){_callback=_callback?_callback.bind(this._conn):this._conn._connect_cb.bind(this._conn);var body=this._buildBody();this._requests.push(new Strophe.Request(body.tree(),this._onRequestStateChange.bind(this,_callback.bind(this._conn)),body.tree().getAttribute("rid"))),this._throttledRequestHandler()},_onDisconnectTimeout:function(){for(var req;this._requests.length>0;)req=this._requests.pop(),req.abort=!0,req.xhr.abort(),req.xhr.onreadystatechange=function(){}},_onIdle:function(){var data=this._conn._data;if(this._conn.authenticated&&0===this._requests.length&&0===data.length&&!this._conn.disconnecting&&(Strophe.info("no requests during idle cycle, sending blank request"),data.push(null)),this._requests.length<2&&data.length>0&&!this._conn.paused){for(var body=this._buildBody(),i=0;i<data.length;i++)null!==data[i]&&("restart"===data[i]?body.attrs({to:this._conn.domain,"xml:lang":"en","xmpp:restart":"true","xmlns:xmpp":Strophe.NS.BOSH}):body.cnode(data[i]).up());delete this._conn._data,this._conn._data=[],this._requests.push(new Strophe.Request(body.tree(),this._onRequestStateChange.bind(this,this._conn._dataRecv.bind(this._conn)),body.tree().getAttribute("rid"))),this._processRequest(this._requests.length-1)}if(this._requests.length>0){var time_elapsed=this._requests[0].age();null!==this._requests[0].dead&&this._requests[0].timeDead()>Math.floor(Strophe.SECONDARY_TIMEOUT*this.wait)&&this._throttledRequestHandler(),time_elapsed>Math.floor(Strophe.TIMEOUT*this.wait)&&(Strophe.warn("Request "+this._requests[0].id+" timed out, over "+Math.floor(Strophe.TIMEOUT*this.wait)+" seconds since last activity"),this._throttledRequestHandler())}},_onRequestStateChange:function(func,req){if(Strophe.debug("request id "+req.id+"."+req.sends+" state changed to "+req.xhr.readyState),req.abort)return void(req.abort=!1);var reqStatus;if(4==req.xhr.readyState){reqStatus=0;try{reqStatus=req.xhr.status}catch(e){}if("undefined"==typeof reqStatus&&(reqStatus=0),this.disconnecting&&reqStatus>=400)return void this._hitError(reqStatus);var reqIs0=this._requests[0]==req,reqIs1=this._requests[1]==req;(reqStatus>0&&500>reqStatus||req.sends>5)&&(this._removeRequest(req),Strophe.debug("request id "+req.id+" should now be removed")),200==reqStatus?((reqIs1||reqIs0&&this._requests.length>0&&this._requests[0].age()>Math.floor(Strophe.SECONDARY_TIMEOUT*this.wait))&&this._restartRequest(0),Strophe.debug("request id "+req.id+"."+req.sends+" got 200"),func(req),this.errors=0):(Strophe.error("request id "+req.id+"."+req.sends+" error "+reqStatus+" happened"),(0===reqStatus||reqStatus>=400&&600>reqStatus||reqStatus>=12e3)&&(this._hitError(reqStatus),reqStatus>=400&&500>reqStatus&&(this._conn._changeConnectStatus(Strophe.Status.DISCONNECTING,null),this._conn._doDisconnect()))),reqStatus>0&&500>reqStatus||req.sends>5||this._throttledRequestHandler()}},_processRequest:function(i){var self=this,req=this._requests[i],reqStatus=-1;try{4==req.xhr.readyState&&(reqStatus=req.xhr.status)}catch(e){Strophe.error("caught an error in _requests["+i+"], reqStatus: "+reqStatus)}if("undefined"==typeof reqStatus&&(reqStatus=-1),req.sends>this.maxRetries)return void this._onDisconnectTimeout();var time_elapsed=req.age(),primaryTimeout=!isNaN(time_elapsed)&&time_elapsed>Math.floor(Strophe.TIMEOUT*this.wait),secondaryTimeout=null!==req.dead&&req.timeDead()>Math.floor(Strophe.SECONDARY_TIMEOUT*this.wait),requestCompletedWithServerError=4==req.xhr.readyState&&(1>reqStatus||reqStatus>=500);if((primaryTimeout||secondaryTimeout||requestCompletedWithServerError)&&(secondaryTimeout&&Strophe.error("Request "+this._requests[i].id+" timed out (secondary), restarting"),req.abort=!0,req.xhr.abort(),req.xhr.onreadystatechange=function(){},this._requests[i]=new Strophe.Request(req.xmlData,req.origFunc,req.rid,req.sends),req=this._requests[i]),0===req.xhr.readyState){Strophe.debug("request id "+req.id+"."+req.sends+" posting");try{req.xhr.open("POST",this._conn.service,this._conn.options.sync?!1:!0)}catch(e2){return Strophe.error("XHR open failed."),this._conn.connected||this._conn._changeConnectStatus(Strophe.Status.CONNFAIL,"bad-service"),void this._conn.disconnect()}var sendFunc=function(){if(req.date=new Date,self._conn.options.customHeaders){var headers=self._conn.options.customHeaders;for(var header in headers)headers.hasOwnProperty(header)&&req.xhr.setRequestHeader(header,headers[header])}req.xhr.setRequestHeader("Content-Type","text/plain"),req.xhr.send(req.data)};if(req.sends>1){var backoff=1e3*Math.min(Math.floor(Strophe.TIMEOUT*this.wait),Math.pow(req.sends,3));setTimeout(sendFunc,backoff)}else sendFunc();req.sends++,this._conn.xmlOutput!==Strophe.Connection.prototype.xmlOutput&&this._conn.xmlOutput(req.xmlData.nodeName===this.strip&&req.xmlData.childNodes.length?req.xmlData.childNodes[0]:req.xmlData),this._conn.rawOutput!==Strophe.Connection.prototype.rawOutput&&this._conn.rawOutput(req.data)}else Strophe.debug("_processRequest: "+(0===i?"first":"second")+" request has readyState of "+req.xhr.readyState)},_removeRequest:function(req){Strophe.debug("removing request");var i;for(i=this._requests.length-1;i>=0;i--)req==this._requests[i]&&this._requests.splice(i,1);req.xhr.onreadystatechange=function(){},this._throttledRequestHandler()},_restartRequest:function(i){var req=this._requests[i];null===req.dead&&(req.dead=new Date),this._processRequest(i)},_reqToData:function(req){try{return req.getResponse()}catch(e){if("parsererror"!=e)throw e;this._conn.disconnect("strophe-parsererror")}},_sendTerminate:function(pres){Strophe.info("_sendTerminate was called");var body=this._buildBody().attrs({type:"terminate"});pres&&body.cnode(pres.tree());var req=new Strophe.Request(body.tree(),this._onRequestStateChange.bind(this,this._conn._dataRecv.bind(this._conn)),body.tree().getAttribute("rid"));this._requests.push(req),this._throttledRequestHandler()},_send:function(){clearTimeout(this._conn._idleTimeout),this._throttledRequestHandler(),this._conn._idleTimeout=setTimeout(this._conn._onIdle.bind(this._conn),100)},_sendRestart:function(){this._throttledRequestHandler(),clearTimeout(this._conn._idleTimeout)},_throttledRequestHandler:function(){Strophe.debug(this._requests?"_throttledRequestHandler called with "+this._requests.length+" requests":"_throttledRequestHandler called with undefined requests"),this._requests&&0!==this._requests.length&&(this._requests.length>0&&this._processRequest(0),this._requests.length>1&&Math.abs(this._requests[0].rid-this._requests[1].rid)<this.window&&this._processRequest(1))}},Strophe.Websocket=function(connection){this._conn=connection,this.strip="stream:stream";var service=connection.service;if(0!==service.indexOf("ws:")&&0!==service.indexOf("wss:")){var new_service="";new_service+="ws"===connection.options.protocol&&"https:"!==window.location.protocol?"ws":"wss",new_service+="://"+window.location.host,new_service+=0!==service.indexOf("/")?window.location.pathname+service:service,connection.service=new_service}},Strophe.Websocket.prototype={_buildStream:function(){return $build("stream:stream",{to:this._conn.domain,xmlns:Strophe.NS.CLIENT,"xmlns:stream":Strophe.NS.STREAM,version:"1.0"})},_check_streamerror:function(bodyWrap,connectstatus){var errors=bodyWrap.getElementsByTagName("stream:error");if(0===errors.length)return!1;for(var error=errors[0],condition="",text="",ns="urn:ietf:params:xml:ns:xmpp-streams",i=0;i<error.childNodes.length;i++){var e=error.childNodes[i];if(e.getAttribute("xmlns")!==ns)break;"text"===e.nodeName?text=e.textContent:condition=e.nodeName}var errorString="WebSocket stream error: ";return errorString+=condition?condition:"unknown",text&&(errorString+=" - "+condition),Strophe.error(errorString),this._conn._changeConnectStatus(connectstatus,condition),this._conn._doDisconnect(),!0},_reset:function(){},_connect:function(){this._closeSocket(),this.socket=new WebSocket(this._conn.service,"xmpp"),this.socket.onopen=this._onOpen.bind(this),this.socket.onerror=this._onError.bind(this),this.socket.onclose=this._onClose.bind(this),this.socket.onmessage=this._connect_cb_wrapper.bind(this)},_connect_cb:function(bodyWrap){var error=this._check_streamerror(bodyWrap,Strophe.Status.CONNFAIL);return error?Strophe.Status.CONNFAIL:void 0},_handleStreamStart:function(message){var error=!1,ns=message.getAttribute("xmlns");"string"!=typeof ns?error="Missing xmlns in stream:stream":ns!==Strophe.NS.CLIENT&&(error="Wrong xmlns in stream:stream: "+ns);var ns_stream=message.namespaceURI;"string"!=typeof ns_stream?error="Missing xmlns:stream in stream:stream":ns_stream!==Strophe.NS.STREAM&&(error="Wrong xmlns:stream in stream:stream: "+ns_stream);var ver=message.getAttribute("version");return"string"!=typeof ver?error="Missing version in stream:stream":"1.0"!==ver&&(error="Wrong version in stream:stream: "+ver),error?(this._conn._changeConnectStatus(Strophe.Status.CONNFAIL,error),this._conn._doDisconnect(),!1):!0},_connect_cb_wrapper:function(message){if(0===message.data.indexOf("<stream:stream ")||0===message.data.indexOf("<?xml")){var data=message.data.replace(/^(<\?.*?\?>\s*)*/,"");if(""===data)return;data=message.data.replace(/<stream:stream (.*[^\/])>/,"<stream:stream $1/>");var streamStart=(new DOMParser).parseFromString(data,"text/xml").documentElement;this._conn.xmlInput(streamStart),this._conn.rawInput(message.data),this._handleStreamStart(streamStart)&&(this._connect_cb(streamStart),this.streamStart=message.data.replace(/^<stream:(.*)\/>$/,"<stream:$1>"))}else{if("</stream:stream>"===message.data)return this._conn.rawInput(message.data),this._conn.xmlInput(document.createElement("stream:stream")),this._conn._changeConnectStatus(Strophe.Status.CONNFAIL,"Received closing stream"),void this._conn._doDisconnect();var string=this._streamWrap(message.data),elem=(new DOMParser).parseFromString(string,"text/xml").documentElement;this.socket.onmessage=this._onMessage.bind(this),this._conn._connect_cb(elem,null,message.data)}},_disconnect:function(pres){if(this.socket.readyState!==WebSocket.CLOSED){pres&&this._conn.send(pres);var close="</stream:stream>";this._conn.xmlOutput(document.createElement("stream:stream")),this._conn.rawOutput(close);try{this.socket.send(close)}catch(e){Strophe.info("Couldn't send closing stream tag.")}}this._conn._doDisconnect()},_doDisconnect:function(){Strophe.info("WebSockets _doDisconnect was called"),this._closeSocket()},_streamWrap:function(stanza){return this.streamStart+stanza+"</stream:stream>"},_closeSocket:function(){if(this.socket)try{this.socket.close()}catch(e){}this.socket=null},_emptyQueue:function(){return!0},_onClose:function(){this._conn.connected&&!this._conn.disconnecting?(Strophe.error("Websocket closed unexcectedly"),this._conn._doDisconnect()):Strophe.info("Websocket closed")},_no_auth_received:function(_callback){Strophe.error("Server did not send any auth methods"),this._conn._changeConnectStatus(Strophe.Status.CONNFAIL,"Server did not send any auth methods"),_callback&&(_callback=_callback.bind(this._conn))(),this._conn._doDisconnect()},_onDisconnectTimeout:function(){},_onError:function(error){Strophe.error("Websocket error "+error),this._conn._changeConnectStatus(Strophe.Status.CONNFAIL,"The WebSocket connection could not be established was disconnected."),this._disconnect()},_onIdle:function(){var data=this._conn._data;if(data.length>0&&!this._conn.paused){for(var i=0;i<data.length;i++)if(null!==data[i]){var stanza,rawStanza;"restart"===data[i]?(stanza=this._buildStream(),rawStanza=this._removeClosingTag(stanza),stanza=stanza.tree()):(stanza=data[i],rawStanza=Strophe.serialize(stanza)),this._conn.xmlOutput(stanza),this._conn.rawOutput(rawStanza),this.socket.send(rawStanza)}this._conn._data=[]}},_onMessage:function(message){var elem,data;if("</stream:stream>"===message.data){var close="</stream:stream>";return this._conn.rawInput(close),this._conn.xmlInput(document.createElement("stream:stream")),void(this._conn.disconnecting||this._conn._doDisconnect())}if(0===message.data.search("<stream:stream ")){if(data=message.data.replace(/<stream:stream (.*[^\/])>/,"<stream:stream $1/>"),elem=(new DOMParser).parseFromString(data,"text/xml").documentElement,!this._handleStreamStart(elem))return}else data=this._streamWrap(message.data),elem=(new DOMParser).parseFromString(data,"text/xml").documentElement;if(!this._check_streamerror(elem,Strophe.Status.ERROR))return this._conn.disconnecting&&"presence"===elem.firstChild.nodeName&&"unavailable"===elem.firstChild.getAttribute("type")?(this._conn.xmlInput(elem),void this._conn.rawInput(Strophe.serialize(elem))):void this._conn._dataRecv(elem,message.data)},_onOpen:function(){Strophe.info("Websocket open");var start=this._buildStream();this._conn.xmlOutput(start.tree());var startString=this._removeClosingTag(start);this._conn.rawOutput(startString),this.socket.send(startString)},_removeClosingTag:function(elem){var string=Strophe.serialize(elem);return string=string.replace(/<(stream:stream .*[^\/])\/>$/,"<$1>")},_reqToData:function(stanza){return stanza},_send:function(){this._conn.flush()},_sendRestart:function(){clearTimeout(this._conn._idleTimeout),this._conn._onIdle.bind(this._conn)()}};
},{}],16:[function(require,module,exports){
;(function (root, factory) {
	if (typeof exports === "object") {
		// CommonJS
		module.exports = exports = factory();
	}
	else if (typeof define === "function" && define.amd) {
		// AMD
		define([], factory);
	}
	else {
		// Global (browser)
		root.CryptoJS = factory();
	}
}(this, function () {

	/**
	 * CryptoJS core components.
	 */
	var CryptoJS = CryptoJS || (function (Math, undefined) {
	    /**
	     * CryptoJS namespace.
	     */
	    var C = {};

	    /**
	     * Library namespace.
	     */
	    var C_lib = C.lib = {};

	    /**
	     * Base object for prototypal inheritance.
	     */
	    var Base = C_lib.Base = (function () {
	        function F() {}

	        return {
	            /**
	             * Creates a new object that inherits from this object.
	             *
	             * @param {Object} overrides Properties to copy into the new object.
	             *
	             * @return {Object} The new object.
	             *
	             * @static
	             *
	             * @example
	             *
	             *     var MyType = CryptoJS.lib.Base.extend({
	             *         field: 'value',
	             *
	             *         method: function () {
	             *         }
	             *     });
	             */
	            extend: function (overrides) {
	                // Spawn
	                F.prototype = this;
	                var subtype = new F();

	                // Augment
	                if (overrides) {
	                    subtype.mixIn(overrides);
	                }

	                // Create default initializer
	                if (!subtype.hasOwnProperty('init')) {
	                    subtype.init = function () {
	                        subtype.$super.init.apply(this, arguments);
	                    };
	                }

	                // Initializer's prototype is the subtype object
	                subtype.init.prototype = subtype;

	                // Reference supertype
	                subtype.$super = this;

	                return subtype;
	            },

	            /**
	             * Extends this object and runs the init method.
	             * Arguments to create() will be passed to init().
	             *
	             * @return {Object} The new object.
	             *
	             * @static
	             *
	             * @example
	             *
	             *     var instance = MyType.create();
	             */
	            create: function () {
	                var instance = this.extend();
	                instance.init.apply(instance, arguments);

	                return instance;
	            },

	            /**
	             * Initializes a newly created object.
	             * Override this method to add some logic when your objects are created.
	             *
	             * @example
	             *
	             *     var MyType = CryptoJS.lib.Base.extend({
	             *         init: function () {
	             *             // ...
	             *         }
	             *     });
	             */
	            init: function () {
	            },

	            /**
	             * Copies properties into this object.
	             *
	             * @param {Object} properties The properties to mix in.
	             *
	             * @example
	             *
	             *     MyType.mixIn({
	             *         field: 'value'
	             *     });
	             */
	            mixIn: function (properties) {
	                for (var propertyName in properties) {
	                    if (properties.hasOwnProperty(propertyName)) {
	                        this[propertyName] = properties[propertyName];
	                    }
	                }

	                // IE won't copy toString using the loop above
	                if (properties.hasOwnProperty('toString')) {
	                    this.toString = properties.toString;
	                }
	            },

	            /**
	             * Creates a copy of this object.
	             *
	             * @return {Object} The clone.
	             *
	             * @example
	             *
	             *     var clone = instance.clone();
	             */
	            clone: function () {
	                return this.init.prototype.extend(this);
	            }
	        };
	    }());

	    /**
	     * An array of 32-bit words.
	     *
	     * @property {Array} words The array of 32-bit words.
	     * @property {number} sigBytes The number of significant bytes in this word array.
	     */
	    var WordArray = C_lib.WordArray = Base.extend({
	        /**
	         * Initializes a newly created word array.
	         *
	         * @param {Array} words (Optional) An array of 32-bit words.
	         * @param {number} sigBytes (Optional) The number of significant bytes in the words.
	         *
	         * @example
	         *
	         *     var wordArray = CryptoJS.lib.WordArray.create();
	         *     var wordArray = CryptoJS.lib.WordArray.create([0x00010203, 0x04050607]);
	         *     var wordArray = CryptoJS.lib.WordArray.create([0x00010203, 0x04050607], 6);
	         */
	        init: function (words, sigBytes) {
	            words = this.words = words || [];

	            if (sigBytes != undefined) {
	                this.sigBytes = sigBytes;
	            } else {
	                this.sigBytes = words.length * 4;
	            }
	        },

	        /**
	         * Converts this word array to a string.
	         *
	         * @param {Encoder} encoder (Optional) The encoding strategy to use. Default: CryptoJS.enc.Hex
	         *
	         * @return {string} The stringified word array.
	         *
	         * @example
	         *
	         *     var string = wordArray + '';
	         *     var string = wordArray.toString();
	         *     var string = wordArray.toString(CryptoJS.enc.Utf8);
	         */
	        toString: function (encoder) {
	            return (encoder || Hex).stringify(this);
	        },

	        /**
	         * Concatenates a word array to this word array.
	         *
	         * @param {WordArray} wordArray The word array to append.
	         *
	         * @return {WordArray} This word array.
	         *
	         * @example
	         *
	         *     wordArray1.concat(wordArray2);
	         */
	        concat: function (wordArray) {
	            // Shortcuts
	            var thisWords = this.words;
	            var thatWords = wordArray.words;
	            var thisSigBytes = this.sigBytes;
	            var thatSigBytes = wordArray.sigBytes;

	            // Clamp excess bits
	            this.clamp();

	            // Concat
	            if (thisSigBytes % 4) {
	                // Copy one byte at a time
	                for (var i = 0; i < thatSigBytes; i++) {
	                    var thatByte = (thatWords[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
	                    thisWords[(thisSigBytes + i) >>> 2] |= thatByte << (24 - ((thisSigBytes + i) % 4) * 8);
	                }
	            } else if (thatWords.length > 0xffff) {
	                // Copy one word at a time
	                for (var i = 0; i < thatSigBytes; i += 4) {
	                    thisWords[(thisSigBytes + i) >>> 2] = thatWords[i >>> 2];
	                }
	            } else {
	                // Copy all words at once
	                thisWords.push.apply(thisWords, thatWords);
	            }
	            this.sigBytes += thatSigBytes;

	            // Chainable
	            return this;
	        },

	        /**
	         * Removes insignificant bits.
	         *
	         * @example
	         *
	         *     wordArray.clamp();
	         */
	        clamp: function () {
	            // Shortcuts
	            var words = this.words;
	            var sigBytes = this.sigBytes;

	            // Clamp
	            words[sigBytes >>> 2] &= 0xffffffff << (32 - (sigBytes % 4) * 8);
	            words.length = Math.ceil(sigBytes / 4);
	        },

	        /**
	         * Creates a copy of this word array.
	         *
	         * @return {WordArray} The clone.
	         *
	         * @example
	         *
	         *     var clone = wordArray.clone();
	         */
	        clone: function () {
	            var clone = Base.clone.call(this);
	            clone.words = this.words.slice(0);

	            return clone;
	        },

	        /**
	         * Creates a word array filled with random bytes.
	         *
	         * @param {number} nBytes The number of random bytes to generate.
	         *
	         * @return {WordArray} The random word array.
	         *
	         * @static
	         *
	         * @example
	         *
	         *     var wordArray = CryptoJS.lib.WordArray.random(16);
	         */
	        random: function (nBytes) {
	            var words = [];

	            var r = (function (m_w) {
	                var m_w = m_w;
	                var m_z = 0x3ade68b1;
	                var mask = 0xffffffff;

	                return function () {
	                    m_z = (0x9069 * (m_z & 0xFFFF) + (m_z >> 0x10)) & mask;
	                    m_w = (0x4650 * (m_w & 0xFFFF) + (m_w >> 0x10)) & mask;
	                    var result = ((m_z << 0x10) + m_w) & mask;
	                    result /= 0x100000000;
	                    result += 0.5;
	                    return result * (Math.random() > .5 ? 1 : -1);
	                }
	            });

	            for (var i = 0, rcache; i < nBytes; i += 4) {
	                var _r = r((rcache || Math.random()) * 0x100000000);

	                rcache = _r() * 0x3ade67b7;
	                words.push((_r() * 0x100000000) | 0);
	            }

	            return new WordArray.init(words, nBytes);
	        }
	    });

	    /**
	     * Encoder namespace.
	     */
	    var C_enc = C.enc = {};

	    /**
	     * Hex encoding strategy.
	     */
	    var Hex = C_enc.Hex = {
	        /**
	         * Converts a word array to a hex string.
	         *
	         * @param {WordArray} wordArray The word array.
	         *
	         * @return {string} The hex string.
	         *
	         * @static
	         *
	         * @example
	         *
	         *     var hexString = CryptoJS.enc.Hex.stringify(wordArray);
	         */
	        stringify: function (wordArray) {
	            // Shortcuts
	            var words = wordArray.words;
	            var sigBytes = wordArray.sigBytes;

	            // Convert
	            var hexChars = [];
	            for (var i = 0; i < sigBytes; i++) {
	                var bite = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
	                hexChars.push((bite >>> 4).toString(16));
	                hexChars.push((bite & 0x0f).toString(16));
	            }

	            return hexChars.join('');
	        },

	        /**
	         * Converts a hex string to a word array.
	         *
	         * @param {string} hexStr The hex string.
	         *
	         * @return {WordArray} The word array.
	         *
	         * @static
	         *
	         * @example
	         *
	         *     var wordArray = CryptoJS.enc.Hex.parse(hexString);
	         */
	        parse: function (hexStr) {
	            // Shortcut
	            var hexStrLength = hexStr.length;

	            // Convert
	            var words = [];
	            for (var i = 0; i < hexStrLength; i += 2) {
	                words[i >>> 3] |= parseInt(hexStr.substr(i, 2), 16) << (24 - (i % 8) * 4);
	            }

	            return new WordArray.init(words, hexStrLength / 2);
	        }
	    };

	    /**
	     * Latin1 encoding strategy.
	     */
	    var Latin1 = C_enc.Latin1 = {
	        /**
	         * Converts a word array to a Latin1 string.
	         *
	         * @param {WordArray} wordArray The word array.
	         *
	         * @return {string} The Latin1 string.
	         *
	         * @static
	         *
	         * @example
	         *
	         *     var latin1String = CryptoJS.enc.Latin1.stringify(wordArray);
	         */
	        stringify: function (wordArray) {
	            // Shortcuts
	            var words = wordArray.words;
	            var sigBytes = wordArray.sigBytes;

	            // Convert
	            var latin1Chars = [];
	            for (var i = 0; i < sigBytes; i++) {
	                var bite = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
	                latin1Chars.push(String.fromCharCode(bite));
	            }

	            return latin1Chars.join('');
	        },

	        /**
	         * Converts a Latin1 string to a word array.
	         *
	         * @param {string} latin1Str The Latin1 string.
	         *
	         * @return {WordArray} The word array.
	         *
	         * @static
	         *
	         * @example
	         *
	         *     var wordArray = CryptoJS.enc.Latin1.parse(latin1String);
	         */
	        parse: function (latin1Str) {
	            // Shortcut
	            var latin1StrLength = latin1Str.length;

	            // Convert
	            var words = [];
	            for (var i = 0; i < latin1StrLength; i++) {
	                words[i >>> 2] |= (latin1Str.charCodeAt(i) & 0xff) << (24 - (i % 4) * 8);
	            }

	            return new WordArray.init(words, latin1StrLength);
	        }
	    };

	    /**
	     * UTF-8 encoding strategy.
	     */
	    var Utf8 = C_enc.Utf8 = {
	        /**
	         * Converts a word array to a UTF-8 string.
	         *
	         * @param {WordArray} wordArray The word array.
	         *
	         * @return {string} The UTF-8 string.
	         *
	         * @static
	         *
	         * @example
	         *
	         *     var utf8String = CryptoJS.enc.Utf8.stringify(wordArray);
	         */
	        stringify: function (wordArray) {
	            try {
	                return decodeURIComponent(escape(Latin1.stringify(wordArray)));
	            } catch (e) {
	                throw new Error('Malformed UTF-8 data');
	            }
	        },

	        /**
	         * Converts a UTF-8 string to a word array.
	         *
	         * @param {string} utf8Str The UTF-8 string.
	         *
	         * @return {WordArray} The word array.
	         *
	         * @static
	         *
	         * @example
	         *
	         *     var wordArray = CryptoJS.enc.Utf8.parse(utf8String);
	         */
	        parse: function (utf8Str) {
	            return Latin1.parse(unescape(encodeURIComponent(utf8Str)));
	        }
	    };

	    /**
	     * Abstract buffered block algorithm template.
	     *
	     * The property blockSize must be implemented in a concrete subtype.
	     *
	     * @property {number} _minBufferSize The number of blocks that should be kept unprocessed in the buffer. Default: 0
	     */
	    var BufferedBlockAlgorithm = C_lib.BufferedBlockAlgorithm = Base.extend({
	        /**
	         * Resets this block algorithm's data buffer to its initial state.
	         *
	         * @example
	         *
	         *     bufferedBlockAlgorithm.reset();
	         */
	        reset: function () {
	            // Initial values
	            this._data = new WordArray.init();
	            this._nDataBytes = 0;
	        },

	        /**
	         * Adds new data to this block algorithm's buffer.
	         *
	         * @param {WordArray|string} data The data to append. Strings are converted to a WordArray using UTF-8.
	         *
	         * @example
	         *
	         *     bufferedBlockAlgorithm._append('data');
	         *     bufferedBlockAlgorithm._append(wordArray);
	         */
	        _append: function (data) {
	            // Convert string to WordArray, else assume WordArray already
	            if (typeof data == 'string') {
	                data = Utf8.parse(data);
	            }

	            // Append
	            this._data.concat(data);
	            this._nDataBytes += data.sigBytes;
	        },

	        /**
	         * Processes available data blocks.
	         *
	         * This method invokes _doProcessBlock(offset), which must be implemented by a concrete subtype.
	         *
	         * @param {boolean} doFlush Whether all blocks and partial blocks should be processed.
	         *
	         * @return {WordArray} The processed data.
	         *
	         * @example
	         *
	         *     var processedData = bufferedBlockAlgorithm._process();
	         *     var processedData = bufferedBlockAlgorithm._process(!!'flush');
	         */
	        _process: function (doFlush) {
	            // Shortcuts
	            var data = this._data;
	            var dataWords = data.words;
	            var dataSigBytes = data.sigBytes;
	            var blockSize = this.blockSize;
	            var blockSizeBytes = blockSize * 4;

	            // Count blocks ready
	            var nBlocksReady = dataSigBytes / blockSizeBytes;
	            if (doFlush) {
	                // Round up to include partial blocks
	                nBlocksReady = Math.ceil(nBlocksReady);
	            } else {
	                // Round down to include only full blocks,
	                // less the number of blocks that must remain in the buffer
	                nBlocksReady = Math.max((nBlocksReady | 0) - this._minBufferSize, 0);
	            }

	            // Count words ready
	            var nWordsReady = nBlocksReady * blockSize;

	            // Count bytes ready
	            var nBytesReady = Math.min(nWordsReady * 4, dataSigBytes);

	            // Process blocks
	            if (nWordsReady) {
	                for (var offset = 0; offset < nWordsReady; offset += blockSize) {
	                    // Perform concrete-algorithm logic
	                    this._doProcessBlock(dataWords, offset);
	                }

	                // Remove processed words
	                var processedWords = dataWords.splice(0, nWordsReady);
	                data.sigBytes -= nBytesReady;
	            }

	            // Return processed words
	            return new WordArray.init(processedWords, nBytesReady);
	        },

	        /**
	         * Creates a copy of this object.
	         *
	         * @return {Object} The clone.
	         *
	         * @example
	         *
	         *     var clone = bufferedBlockAlgorithm.clone();
	         */
	        clone: function () {
	            var clone = Base.clone.call(this);
	            clone._data = this._data.clone();

	            return clone;
	        },

	        _minBufferSize: 0
	    });

	    /**
	     * Abstract hasher template.
	     *
	     * @property {number} blockSize The number of 32-bit words this hasher operates on. Default: 16 (512 bits)
	     */
	    var Hasher = C_lib.Hasher = BufferedBlockAlgorithm.extend({
	        /**
	         * Configuration options.
	         */
	        cfg: Base.extend(),

	        /**
	         * Initializes a newly created hasher.
	         *
	         * @param {Object} cfg (Optional) The configuration options to use for this hash computation.
	         *
	         * @example
	         *
	         *     var hasher = CryptoJS.algo.SHA256.create();
	         */
	        init: function (cfg) {
	            // Apply config defaults
	            this.cfg = this.cfg.extend(cfg);

	            // Set initial values
	            this.reset();
	        },

	        /**
	         * Resets this hasher to its initial state.
	         *
	         * @example
	         *
	         *     hasher.reset();
	         */
	        reset: function () {
	            // Reset data buffer
	            BufferedBlockAlgorithm.reset.call(this);

	            // Perform concrete-hasher logic
	            this._doReset();
	        },

	        /**
	         * Updates this hasher with a message.
	         *
	         * @param {WordArray|string} messageUpdate The message to append.
	         *
	         * @return {Hasher} This hasher.
	         *
	         * @example
	         *
	         *     hasher.update('message');
	         *     hasher.update(wordArray);
	         */
	        update: function (messageUpdate) {
	            // Append
	            this._append(messageUpdate);

	            // Update the hash
	            this._process();

	            // Chainable
	            return this;
	        },

	        /**
	         * Finalizes the hash computation.
	         * Note that the finalize operation is effectively a destructive, read-once operation.
	         *
	         * @param {WordArray|string} messageUpdate (Optional) A final message update.
	         *
	         * @return {WordArray} The hash.
	         *
	         * @example
	         *
	         *     var hash = hasher.finalize();
	         *     var hash = hasher.finalize('message');
	         *     var hash = hasher.finalize(wordArray);
	         */
	        finalize: function (messageUpdate) {
	            // Final message update
	            if (messageUpdate) {
	                this._append(messageUpdate);
	            }

	            // Perform concrete-hasher logic
	            var hash = this._doFinalize();

	            return hash;
	        },

	        blockSize: 512/32,

	        /**
	         * Creates a shortcut function to a hasher's object interface.
	         *
	         * @param {Hasher} hasher The hasher to create a helper for.
	         *
	         * @return {Function} The shortcut function.
	         *
	         * @static
	         *
	         * @example
	         *
	         *     var SHA256 = CryptoJS.lib.Hasher._createHelper(CryptoJS.algo.SHA256);
	         */
	        _createHelper: function (hasher) {
	            return function (message, cfg) {
	                return new hasher.init(cfg).finalize(message);
	            };
	        },

	        /**
	         * Creates a shortcut function to the HMAC's object interface.
	         *
	         * @param {Hasher} hasher The hasher to use in this HMAC helper.
	         *
	         * @return {Function} The shortcut function.
	         *
	         * @static
	         *
	         * @example
	         *
	         *     var HmacSHA256 = CryptoJS.lib.Hasher._createHmacHelper(CryptoJS.algo.SHA256);
	         */
	        _createHmacHelper: function (hasher) {
	            return function (message, key) {
	                return new C_algo.HMAC.init(hasher, key).finalize(message);
	            };
	        }
	    });

	    /**
	     * Algorithm namespace.
	     */
	    var C_algo = C.algo = {};

	    return C;
	}(Math));


	return CryptoJS;

}));
},{}],17:[function(require,module,exports){
;(function (root, factory, undef) {
	if (typeof exports === "object") {
		// CommonJS
		module.exports = exports = factory(require("./core"), require("./sha1"), require("./hmac"));
	}
	else if (typeof define === "function" && define.amd) {
		// AMD
		define(["./core", "./sha1", "./hmac"], factory);
	}
	else {
		// Global (browser)
		factory(root.CryptoJS);
	}
}(this, function (CryptoJS) {

	return CryptoJS.HmacSHA1;

}));
},{"./core":16,"./hmac":18,"./sha1":19}],18:[function(require,module,exports){
;(function (root, factory) {
	if (typeof exports === "object") {
		// CommonJS
		module.exports = exports = factory(require("./core"));
	}
	else if (typeof define === "function" && define.amd) {
		// AMD
		define(["./core"], factory);
	}
	else {
		// Global (browser)
		factory(root.CryptoJS);
	}
}(this, function (CryptoJS) {

	(function () {
	    // Shortcuts
	    var C = CryptoJS;
	    var C_lib = C.lib;
	    var Base = C_lib.Base;
	    var C_enc = C.enc;
	    var Utf8 = C_enc.Utf8;
	    var C_algo = C.algo;

	    /**
	     * HMAC algorithm.
	     */
	    var HMAC = C_algo.HMAC = Base.extend({
	        /**
	         * Initializes a newly created HMAC.
	         *
	         * @param {Hasher} hasher The hash algorithm to use.
	         * @param {WordArray|string} key The secret key.
	         *
	         * @example
	         *
	         *     var hmacHasher = CryptoJS.algo.HMAC.create(CryptoJS.algo.SHA256, key);
	         */
	        init: function (hasher, key) {
	            // Init hasher
	            hasher = this._hasher = new hasher.init();

	            // Convert string to WordArray, else assume WordArray already
	            if (typeof key == 'string') {
	                key = Utf8.parse(key);
	            }

	            // Shortcuts
	            var hasherBlockSize = hasher.blockSize;
	            var hasherBlockSizeBytes = hasherBlockSize * 4;

	            // Allow arbitrary length keys
	            if (key.sigBytes > hasherBlockSizeBytes) {
	                key = hasher.finalize(key);
	            }

	            // Clamp excess bits
	            key.clamp();

	            // Clone key for inner and outer pads
	            var oKey = this._oKey = key.clone();
	            var iKey = this._iKey = key.clone();

	            // Shortcuts
	            var oKeyWords = oKey.words;
	            var iKeyWords = iKey.words;

	            // XOR keys with pad constants
	            for (var i = 0; i < hasherBlockSize; i++) {
	                oKeyWords[i] ^= 0x5c5c5c5c;
	                iKeyWords[i] ^= 0x36363636;
	            }
	            oKey.sigBytes = iKey.sigBytes = hasherBlockSizeBytes;

	            // Set initial values
	            this.reset();
	        },

	        /**
	         * Resets this HMAC to its initial state.
	         *
	         * @example
	         *
	         *     hmacHasher.reset();
	         */
	        reset: function () {
	            // Shortcut
	            var hasher = this._hasher;

	            // Reset
	            hasher.reset();
	            hasher.update(this._iKey);
	        },

	        /**
	         * Updates this HMAC with a message.
	         *
	         * @param {WordArray|string} messageUpdate The message to append.
	         *
	         * @return {HMAC} This HMAC instance.
	         *
	         * @example
	         *
	         *     hmacHasher.update('message');
	         *     hmacHasher.update(wordArray);
	         */
	        update: function (messageUpdate) {
	            this._hasher.update(messageUpdate);

	            // Chainable
	            return this;
	        },

	        /**
	         * Finalizes the HMAC computation.
	         * Note that the finalize operation is effectively a destructive, read-once operation.
	         *
	         * @param {WordArray|string} messageUpdate (Optional) A final message update.
	         *
	         * @return {WordArray} The HMAC.
	         *
	         * @example
	         *
	         *     var hmac = hmacHasher.finalize();
	         *     var hmac = hmacHasher.finalize('message');
	         *     var hmac = hmacHasher.finalize(wordArray);
	         */
	        finalize: function (messageUpdate) {
	            // Shortcut
	            var hasher = this._hasher;

	            // Compute HMAC
	            var innerHash = hasher.finalize(messageUpdate);
	            hasher.reset();
	            var hmac = hasher.finalize(this._oKey.clone().concat(innerHash));

	            return hmac;
	        }
	    });
	}());


}));
},{"./core":16}],19:[function(require,module,exports){
;(function (root, factory) {
	if (typeof exports === "object") {
		// CommonJS
		module.exports = exports = factory(require("./core"));
	}
	else if (typeof define === "function" && define.amd) {
		// AMD
		define(["./core"], factory);
	}
	else {
		// Global (browser)
		factory(root.CryptoJS);
	}
}(this, function (CryptoJS) {

	(function () {
	    // Shortcuts
	    var C = CryptoJS;
	    var C_lib = C.lib;
	    var WordArray = C_lib.WordArray;
	    var Hasher = C_lib.Hasher;
	    var C_algo = C.algo;

	    // Reusable object
	    var W = [];

	    /**
	     * SHA-1 hash algorithm.
	     */
	    var SHA1 = C_algo.SHA1 = Hasher.extend({
	        _doReset: function () {
	            this._hash = new WordArray.init([
	                0x67452301, 0xefcdab89,
	                0x98badcfe, 0x10325476,
	                0xc3d2e1f0
	            ]);
	        },

	        _doProcessBlock: function (M, offset) {
	            // Shortcut
	            var H = this._hash.words;

	            // Working variables
	            var a = H[0];
	            var b = H[1];
	            var c = H[2];
	            var d = H[3];
	            var e = H[4];

	            // Computation
	            for (var i = 0; i < 80; i++) {
	                if (i < 16) {
	                    W[i] = M[offset + i] | 0;
	                } else {
	                    var n = W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16];
	                    W[i] = (n << 1) | (n >>> 31);
	                }

	                var t = ((a << 5) | (a >>> 27)) + e + W[i];
	                if (i < 20) {
	                    t += ((b & c) | (~b & d)) + 0x5a827999;
	                } else if (i < 40) {
	                    t += (b ^ c ^ d) + 0x6ed9eba1;
	                } else if (i < 60) {
	                    t += ((b & c) | (b & d) | (c & d)) - 0x70e44324;
	                } else /* if (i < 80) */ {
	                    t += (b ^ c ^ d) - 0x359d3e2a;
	                }

	                e = d;
	                d = c;
	                c = (b << 30) | (b >>> 2);
	                b = a;
	                a = t;
	            }

	            // Intermediate hash value
	            H[0] = (H[0] + a) | 0;
	            H[1] = (H[1] + b) | 0;
	            H[2] = (H[2] + c) | 0;
	            H[3] = (H[3] + d) | 0;
	            H[4] = (H[4] + e) | 0;
	        },

	        _doFinalize: function () {
	            // Shortcuts
	            var data = this._data;
	            var dataWords = data.words;

	            var nBitsTotal = this._nDataBytes * 8;
	            var nBitsLeft = data.sigBytes * 8;

	            // Add padding
	            dataWords[nBitsLeft >>> 5] |= 0x80 << (24 - nBitsLeft % 32);
	            dataWords[(((nBitsLeft + 64) >>> 9) << 4) + 14] = Math.floor(nBitsTotal / 0x100000000);
	            dataWords[(((nBitsLeft + 64) >>> 9) << 4) + 15] = nBitsTotal;
	            data.sigBytes = dataWords.length * 4;

	            // Hash final blocks
	            this._process();

	            // Return final computed hash
	            return this._hash;
	        },

	        clone: function () {
	            var clone = Hasher.clone.call(this);
	            clone._hash = this._hash.clone();

	            return clone;
	        }
	    });

	    /**
	     * Shortcut function to the hasher's object interface.
	     *
	     * @param {WordArray|string} message The message to hash.
	     *
	     * @return {WordArray} The hash.
	     *
	     * @static
	     *
	     * @example
	     *
	     *     var hash = CryptoJS.SHA1('message');
	     *     var hash = CryptoJS.SHA1(wordArray);
	     */
	    C.SHA1 = Hasher._createHelper(SHA1);

	    /**
	     * Shortcut function to the HMAC's object interface.
	     *
	     * @param {WordArray|string} message The message to hash.
	     * @param {WordArray|string} key The secret key.
	     *
	     * @return {WordArray} The HMAC.
	     *
	     * @static
	     *
	     * @example
	     *
	     *     var hmac = CryptoJS.HmacSHA1(message, key);
	     */
	    C.HmacSHA1 = Hasher._createHmacHelper(SHA1);
	}());


	return CryptoJS.SHA1;

}));
},{"./core":16}],20:[function(require,module,exports){

},{}],21:[function(require,module,exports){
module.exports={
  "name": "quickblox",
  "description": "QuickBlox JavaScript SDK",
  "version": "1.8.1",
  "homepage": "http://quickblox.com/developers/Javascript",
  "main": "js/qbMain.js",
  "license": "MIT",
  "keywords": [
    "quickblox",
    "javascript",
    "sdk",
    "baas",
    "cloud",
    "api"
  ],
  "maintainers": [
    "Andrey Povelichenko <andrey.povelichenko@quickblox.com>",
    "Alex Bass <alex.bass@quickblox.com>"
  ],
  "contributors": [
    "Dan Murphy <dan@quickblox.com>",
    "Andrey Povelichenko <andrey.povelichenko@quickblox.com>",
    "Alex Bass <alex.bass@quickblox.com>"
  ],
  "repository": {
    "type": "git",
    "url": "git://github.com/QuickBlox/quickblox-javascript-sdk.git"
  },
  "bugs": {
    "url": "https://github.com/QuickBlox/quickblox-javascript-sdk/issues",
    "email": "web@quickblox.com"
  },
  "dependencies": {
    "crypto-js": "3.1.2-2",
    "request": "^2.48.0"
  },
  "devDependencies": {
    "grunt": "^0.4.5",
    "grunt-browserify": "^3.2.1",
    "grunt-contrib-uglify": "^0.6.0",
    "grunt-contrib-connect": "^0.9.0",
    "load-grunt-tasks": "^1.0.0"
  }
}

},{}]},{},[10])(10)
});