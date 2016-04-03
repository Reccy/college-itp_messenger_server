/* Setup database connection */
var mysql = require("mysql");
var database = mysql.createConnection({
    host     : 'localhost',
    user     : 'user_accounts_da',
    password : 'j6na78EScAWdUpPH',
    database : 'user_accounts'
});

/* Setup input sanitizer */
var sanitizer = require("sanitizer");

/* Import hashing and salting package */
var bcrypt = require("bcryptjs");

/* Initialize pubnub and channel management */
var pubnub = require("pubnub")(
{
    ssl: true, // Enable TLS Tunneling over TCP, allows the app to run on HTTPS servers.
    publish_key: "pub-c-0932089b-8fc7-4329-b03d-7c47fe828971",
    subscribe_key: "sub-c-a91c35f6-ca98-11e5-a9b2-02ee2ddab7fe",
    heartbeat: 10,
    uuid: "SERVER"
});

/* Variables to manage channel */
var globalChannel = "chan_global";
var nextChannel = "chan_temp";
var dbChannel = "chan_database";
var userlist = []; //Full list of users from the database
var channelList = [];

/* Function to broadcast the next channel and subscribe to next channel */
function broadcastNextChannel(client_uuid)
{
    /* Create the channel name based off of the client's UUID */
    nextChannel = "chan_" + client_uuid;
    var alreadyOnList; //Bool to see if the channel is already connected to the server
    
    //Iterate through the list to see if the channel is already there
    for(i = 0; i < channelList.length; i++)
    {
        if(channelList[i].uuid === client_uuid)
        {
            alreadyOnList = true;
            break;
        }
    }
    
    //If the user is not on the list, add them
    if(!alreadyOnList)
    {
        channelList.push(
        {
            "uuid": client_uuid,
            "chan": nextChannel,
            "username": null
        });
    }
    
    /* Package the next channel ID into a JSON object as a message, of type "initial connect" */
    var msg = (
    {
        "m_type": "initial_connect",
        "uuid": client_uuid,
        "channel": nextChannel
    });
    
    console.log(" > [" + globalChannel + "] BROADCASTING NEXT CHANNEL: " + JSON.stringify(msg));

    /* Send the nextChannel message across the global channel for the client to pickup */
    pubnub.publish(
    {
        channel: globalChannel,
        message: msg,
        callback: function(m)
        {
            if (m[0] == "1")
            {
                console.log(" > [" + globalChannel + "] MESSAGE SENT SUCCESSFULLY: " + m);
            }
            else
            {
                console.log(" > [" + globalChannel + "] MESSAGE SENT FAILED: " + m);
            }
        }
    })

    /* Subscribe to a PRIVATE CHANNEL */
    console.log(" > [PRIVATE CHANNEL] ATTEMPTING CONNECTION...");
    pubnub.subscribe(
    {
        channel: nextChannel,
        message: function(m)
        {
            /*
            *   Handle PRIVATE CHANNEL MESSAGES
            */
            console.log(" > [PRIVATE CHANNEL] MESSAGE RECEIVED: " + JSON.stringify(m));
            
            if(m.m_type === "user_login")
            {
                username = sanitizer.escape(m.username);
                uuid = m.uuid;
                password = sanitizer.escape(m.password);
                
                console.log("Login attempt from: " + username + " at chan_" + uuid);
                
                var loginSuccessful = false;
                var alreadyOnline = false;
                
                //Check if user is already online on another client
                for(i = 0; i < channelList.length; i++) {
                    if(channelList[i].username === username) {
                        alreadyOnline = true;
                    }
                }
                
                //If user is not already online, continue with the login process. Otherwise, notify the user.
                if(!alreadyOnline)
                {
                    //Check the database to match the user's login details
                    database.query('SELECT * FROM Users', function(err, rows, fields) {
                        if (err) throw err;
                        
                        for(i = 0; i < rows.length; i++) {
                            if(username === rows[i].Username) {
                                if(bcrypt.compareSync(password, rows[i].Password))
                                {
                                    loginSuccessful = true;
                                    break;
                                }
                                else
                                {
                                    loginSuccessful = false;
                                    break;
                                }
                            }
                        }
                        //If login is successful, send message to user and add username to channelList
                        if(loginSuccessful){
                            pubnub.publish({
                                channel: "chan_" + uuid,
                                message: {
                                    "m_type" : "user_login_success",
                                    "username" : username
                                },
                                callback: function() {
                                    for(i = 0; i < channelList.length; i++) {
                                        if(channelList[i].uuid === uuid) {
                                            channelList[i].username = username;
                                        }
                                    }
                                    console.log("Login Successful: " + username);
                                }
                            });
                        }
                        else
                        {
                            pubnub.publish({
                                channel: "chan_" + uuid,
                                message: {
                                    "m_type" : "user_login_failed"
                                },
                                callback: function() {
                                    console.log("Login Failed: " + username);
                                }
                            });
                        }
                    });
                }
                else
                {
                    pubnub.publish({
                        channel: "chan_" + uuid,
                        message: {
                            "m_type" : "user_login_duplicate"
                        },
                        callback: function() {
                            console.log("Login Failed [Already Online]: " + username);
                        }
                    });
                }
            }
            else if(m.m_type === "user_login_reconnect")
            {
                username = sanitizer.escape(m.username);
                uuid = m.uuid;
                
                console.log("Reconnection from: " + username);
                
                for(i = 0; i < channelList.length; i++) {
                    if(channelList[i].uuid === uuid) {
                        channelList[i].username = username;
                    }
                }
                console.log("Login Successful: " + username);
            }
            else if(m.m_type === "user_logout")
            {
                username = sanitizer.escape(m.username);
                uuid = m.uuid;
                
                console.log("Logout request from UUID: " + uuid);
                
                for(i = 0; i < channelList.length; i++) {
                    if(channelList[i].uuid === uuid) {
                        channelList[i].username = null;
                    }
                }
                
                console.log("Logout Successful: " + uuid);
            }
            else if(m.m_type === "user_register")
            {
                username = sanitizer.escape(m.username);
                uuid = m.uuid;
                password = sanitizer.escape(m.password);
                password = bcrypt.hashSync(password, 8);
                
                console.log("HASHED PASSWORD: " + password);
                
                console.log("Register attempt from: " + username + " at chan_" + uuid);
                
                var userAlreadyExists = false;
                
                //Check the database to see if user already exists
                database.query("SELECT * FROM Users;", function(err, rows, fields) {
                    if (err) throw err;
                    
                    //Check if user already exists    
                    for(i = 0; i < rows.length; i++) {
                        if(username === rows[i].Username) {
                            userAlreadyExists = true;
                        }
                    }
                    
                    //If the user doesn't exist, continue with registration. Otherwise, notify client of error
                    if(!userAlreadyExists){
                        sqlQuery = "INSERT INTO Users (ID, Username, Password) VALUES ('" + rows.length + "','" + username + "','" + password + "');";
                        console.log("INSERT QUERY: " + sqlQuery);
                        
                        //Add user to database
                        database.query(sqlQuery), function (err, rows, fields) {
                            if(err) throw err;
                        }
                        
                        console.log("USER REGISTERED SUCCESSFULLY!");
                            
                        pubnub.publish({
                            channel: "chan_" + uuid,
                            message: {
                                "m_type" : "user_register_success",
                                "username" : username
                            },
                            callback: function() {
                                for(i = 0; i < channelList.length; i++) {
                                    if(channelList[i].uuid === uuid) {
                                        channelList[i].username = username;
                                    }
                                }
                                
                                console.log("Register Successful: " + username);
                                updateUsernameList();
                            }
                        });
                    }
                    else
                    {
                        pubnub.publish({
                            channel: "chan_" + uuid,
                            message: {
                                "m_type" : "user_register_duplicate"
                            },
                            callback: function() {
                                console.log("Register Failed [Duplicate User]: " + username);
                            }
                        });
                    }
                });
            }
            else if(m.m_type === "chat_start")
            {
                var receiverFound = false; //If the receiver has been found
                var targetChannel = null; //The ID of the target channel
                var sortedUsernames = null; //Array of sorted usernames
                var matchedChannel = null; //Channel matched in loops
                var sender = m.usernames[0];
                var receiver = m.usernames[1];
                
                console.log("NEW CHAT FROM " + sender + " TO " + receiver);
                
                //Creates a channel based on the two usernames, will always be the same for this user pair
                sortedUsernames = m.usernames;
                sortedUsernames.sort();
                console.log("SORTED USERNAMES: " + sortedUsernames);
                targetChannel = asciiEncode(sortedUsernames[0] + sortedUsernames[1]) + "001"; //If history needs to be changed, increment the tail number. To clear channel history, change the name of the _hChan prefix.
                
                //Check if receiver exists
                for(i = 0; i < channelList.length; i++)
                {
                    matchedChannel = channelList[i];
                    if(matchedChannel.username === receiver)
                    {
                        console.log(" > [PRIVATE CHANNEL] Receiver found!");
                        receiverFound = true;
                        
                        console.log("NEW CHANNEL CREATED: " + targetChannel);
                        console.log("SENDING MESSAGE TO: chan_" + matchedChannel.uuid + " as " + matchedChannel.username);
                        
                        //Send connect message to the receiver
                        pubnub.publish({
                            channel: "chan_" + matchedChannel.uuid,
                            message: {
                                "m_type" : "chat_init",
                                "channel" : targetChannel,
                                "username" : sender
                            }
                        });
                        break;
                    }
                }
                var receiverChannelList = []; //Array to store the channel list of the receiver
                
                if(!receiverFound)
                {
                    for(i = 0; i < userlist.length; i++)
                    {
                        if(userlist[i] === receiver)
                        {
                            receiverFound = true;
                            pubnub.history({
                                channel : receiver + "_hChan",
                                callback : function(m){
                                    console.log("M - " + m[0][0]);
                                    if(m[0][0] !== undefined){
                                        receiverChannelList = m[0][0];
                                    } else {
                                        receiverChannelList = [];
                                    }
                                    
                                    console.log("PUSHING");
                                    receiverChannelList.push({
                                        "username": sender,
                                        "channel": targetChannel
                                    });
                                    
                                    console.log("NEW RECEIVER CHANNEL LIST: " + receiverChannelList);
                                    
                                    pubnub.publish({
                                        channel: receiver + "_hChan",
                                        message: receiverChannelList,
                                        callback: function(){
                                            console.log(receiver + "'s Channel List updated!");
                                        }
                                    });
                                    
                                    //Send connect command to sender
                                    for(i = 0; i < channelList.length; i++)
                                    {
                                        if(channelList[i].username === sender)
                                        {
                                            console.log("SENDING MESSAGE TO: chan_" + channelList[i].uuid + " as " + channelList[i].username);
                                            pubnub.publish({
                                                channel: "chan_" + channelList[i].uuid,
                                                message: {
                                                    "m_type": "chat_init",
                                                    "channel": targetChannel,
                                                    "username": receiver
                                                }
                                            });
                                        }
                                    }
                                }
                            });
                        }
                    }
                    if(!receiverFound)
                    {
                        for(i = 0; i < channelList.length; i++)
                        {
                            pubnub.publish({
                                channel: "chan_" + channelList[i].uuid,
                                message: {
                                    "m_type": "chat_error_no_users_found"
                                }
                            });
                        }
                    }
                } else {
                    //Send connect command to sender
                    for(i = 0; i < channelList.length; i++)
                    {
                        if(channelList[i].username === sender)
                        {
                            console.log("SENDING MESSAGE TO: chan_" + channelList[i].uuid + " as " + channelList[i].username);
                            pubnub.publish({
                                channel: "chan_" + channelList[i].uuid,
                                message: {
                                    "m_type": "chat_init",
                                    "channel": targetChannel,
                                    "username": receiver
                                }
                            });
                        }
                    }
                }
            }
        },
        connect: function(m)
        {
            console.log(" > [PRIVATE CHANNEL] CONNECTED TO NEXT CHANNEL");
        },
        error: function(m)
        {
            m = JSON.stringify(m);
            console.log(" > [PRIVATE CHANNEL] CONNECTION ERROR: " + m);
        },
        presence: function(m)
        {
            console.log(" > [PRIVATE CHANNEL] PRESENCE EVENT DETECTED: " + JSON.stringify(m));

            /* If someone leaves the channel, remove channel from the tracking list */
            if (m.action === "leave" || m.action === "timeout")
            {
                for (i = 0; i < channelList.length; i++)
                {
                    if (channelList[i].uuid === m.uuid)
                    {
                        console.log(" > [" + channelList[i].chan + "] USER " + m.uuid + " LEFT AT " + m.timestamp);
                        pubnub.unsubscribe(
                        {
                            channel: channelList[i].chan,
                            callback: function(m)
                            {
                                console.log(" > UNSUBSCRIBE CALLBACK: " + JSON.stringify(m));
                            }
                        });
                        channelList.splice(i, 1);
                        break;
                    }
                }
            }
        }
    });
}

/* Checks channel list to remove any dead channels */
function verifyChannelList()
{
    console.log("\n > VERIFYING CHANNEL LIST");
    pubnub.here_now(
    {
        callback: function(m)
        {
            for (i = 0; i < channelList.length; i++)
            {
                console.log(channelList[i].chan + " occupancy: " + jsonPath(m, "$.channels." + channelList[i].chan + ".occupancy")[0] + " || typeof: " + typeof(jsonPath(m, "$.channels." + channelList[i].chan + ".occupancy")[0]));
                if ((jsonPath(m, "$.channels." + channelList[i].chan + ".occupancy")[0] < 2) || (typeof jsonPath(m, "$.channels." + channelList[i].chan + ".occupancy")[0] === "undefined"))
                {
                    console.log("Removing: " + channelList[i].chan);
                    pubnub.unsubscribe(
                    {
                        channel: channelList[i].chan,
                        callback: function(m)
                        {
                            console.log(" > UNSUBSCRIBE CALLBACK: " + JSON.stringify(m));
                        }
                    });
                    channelList.splice(i, 1);
                    i--;
                }
            }
            console.log(" > DONE\n");
        }
    });
}

/*************************/
/* DEBUG FUNCTIONS START */
/*************************/

function globalConnections()
{
    pubnub.here_now(
    {
        channel: globalChannel,
        callback: function(m)
        {
            console.log(JSON.stringify(m));
        }
    });
}

function allConnections()
{
    pubnub.here_now(
    {
        callback: function(m)
        {
            console.log(JSON.stringify(m));
        }
    });
}

function viewChannelList()
{
    console.log("==========LIST OF UUID/CHANNEL PAIRS==========");
    if (channelList == 0)
    {
        console.log("NO CHANNELS CONNECTED!");
    }
    else
    {
        for (i = 0; i < channelList.length; i++)
        {
            console.log("UUID: " + channelList[i].uuid + " | CHAN: " + channelList[i].chan + " | USERNAME: " + channelList[i].username);
        }
    }
    console.log("\nTOTAL CHANNELS: " + channelList.length);
    console.log("==============================================");
}

function shutdown()
{
    console.log("==========SHUTTING DOWN==========");
    console.log(" > Sending shutdown message to GLOBAL CHANNEL");
    
    pubnub.publish({
        channel: globalChannel,
        message: {"m_type":"server_shutdown"},
        callback: function(m)
        {
            console.log(" > Unsubscribing from GLOBAL CHANNEL");
            pubnub.unsubscribe({
                channel: globalChannel,
                callback: function(m)
                {
                    console.log(" > Unsubscribed successfully!");
                    console.log(" > Sending shutdown message to PRIVATE CHANNELS");
                    if(channelList.length > 0)
                    {
                        var channelsConnected = channelList.length;
                        var maxChannelsConnected = channelList.length;
                        
                        for(i = 0; i < maxChannelsConnected; i++)
                        {
                            pubnub.publish({
                                channel: channelList[i].chan,
                                message: {"m_type":"server_shutdown"},
                                callback: function(m)
                                {
                                    channelsConnected--;
                                    if(channelsConnected === 0)
                                    {
                                        console.log(" > SHUTDOWN COMPLETE!");
                                        process.exit(0);
                                    }
                                }
                            });
                        }
                    }
                    else
                    {
                        console.log(" > No private channels connected!");
                        console.log(" > Disconnecting from Databasse");
                        database.end(function(err){
                            console.log(" > SHUTDOWN COMPLETE!");
                            process.exit(0);
                        });
                    }
                }
            });
        }
    });
}

var stdin = process.openStdin();
stdin.on('data', function(input)
{
    input = input.toString().trim();
    console.log("");
    console.log(" > RUNNING: " + input);
    console.log("");

    if (input === "globalConnections")
    {
        globalConnections();
    }
    else if (input === "allConnections")
    {
        allConnections();
    }
    else if (input === "viewChannelList")
    {
        viewChannelList();
    }
    else if (input === "verifyChannelList")
    {
        verifyChannelList();
    }
    else if (input === "shutdown")
    {
        shutdown();
    }
    else
    {
        console.log(" > INVALID COMMAND!");
    }
});
/***********************/
/* DEBUG FUNCTIONS END */
/***********************/

/****************/
/* SERVER START */
/****************/

console.log(" > [" + globalChannel + "] ATTEMPTING CONNECTION TO DATABASE");

//Connect to the database
database.connect(function(err){
    if (err){
        console.log(" > [" + globalChannel + "] ERROR CONNECTING TO DATABASE. SHUTTING DOWN!");
        shutdown();
    }
    else
    {
        console.log(" > [" + globalChannel + "] CONNECTED TO DATABASE!");
        updateUsernameList();
    }
});

function updateUsernameList(){
    database.query('SELECT Username FROM Users', function (err, rows, fields) {
        if(err) throw err;
        
        console.log(" > [" + globalChannel + "] GETTING LIST OF USERS");
        
        userlist.length = 0;
        for(i = 0; i < rows.length; i++){
            userlist.push(rows[i].Username);
        }
        
        console.log(" > [" + dbChannel + "] BROADCASTING DATABASE CHANGES");
        
        pubnub.publish({
            channel: dbChannel,
            message: {
                "m_type" : "db_results",
                "usernames" : userlist
            }
        });

        createGlobalChannel();
    });
}

function createGlobalChannel(){
    pubnub.subscribe(
    {
        channel: globalChannel,
        message: function(m)
        {
            console.log(" > [" + globalChannel + "] MESSAGE RECEIVED: " + JSON.stringify(m));
        },
        connect: function(m)
        {
            console.log(" > [" + globalChannel + "] CONNECTED TO GLOBAL CHANNEL");
        },
        error: function(error)
        {
            console.log(JSON.stringify(error));
        },
        presence: function(m)
        {
            console.log(" > [" + globalChannel + "] PRESENCE EVENT DETECTED: " + JSON.stringify(m));
    
            /* If a user joins the channel, allocate them a private channel */
            if (m.uuid !== "SERVER" && m.action === "join")
            {
                broadcastNextChannel(m.uuid);
            }
        }
    });
    /* Check channel list every 2 minutes */
    setInterval(function()
    {
        verifyChannelList();
    }, 2 * 60 * 1000);
}


function asciiEncode(string){
    
    result = "";
    
    for(i = 0; i < string.length; i++)
    {
        result = result + string.charCodeAt(i);
    }
    
    return result;
}

/**************/
/* SERVER END */
/**************/

/*****************************************************/
/*****************************************************/
/*****************************************************/
/* JSONPath 0.8.0 - XPath for JSON
 *
 * Copyright (c) 2007 Stefan Goessner (goessner.net)
 * Licensed under the MIT (MIT-LICENSE.txt) licence.
 */
function jsonPath(obj, expr, arg)
{
    var P = {
        resultType: arg && arg.resultType || "VALUE",
        result: [],
        normalize: function(expr)
        {
            var subx = [];
            return expr.replace(/[\['](\??\(.*?\))[\]']/g, function($0, $1)
                {
                    return "[#" + (subx.push($1) - 1) + "]";
                })
                .replace(/'?\.'?|\['?/g, ";")
                .replace(/;;;|;;/g, ";..;")
                .replace(/;$|'?\]|'$/g, "")
                .replace(/#([0-9]+)/g, function($0, $1)
                {
                    return subx[$1];
                });
        },
        asPath: function(path)
        {
            var x = path.split(";"),
                p = "$";
            for (var i = 1, n = x.length; i < n; i++)
                p += /^[0-9*]+$/.test(x[i]) ? ("[" + x[i] + "]") : ("['" + x[i] + "']");
            return p;
        },
        store: function(p, v)
        {
            if (p) P.result[P.result.length] = P.resultType == "PATH" ? P.asPath(p) : v;
            return !!p;
        },
        trace: function(expr, val, path)
        {
            if (expr)
            {
                var x = expr.split(";"),
                    loc = x.shift();
                x = x.join(";");
                if (val && val.hasOwnProperty(loc))
                    P.trace(x, val[loc], path + ";" + loc);
                else if (loc === "*")
                    P.walk(loc, x, val, path, function(m, l, x, v, p)
                    {
                        P.trace(m + ";" + x, v, p);
                    });
                else if (loc === "..")
                {
                    P.trace(x, val, path);
                    P.walk(loc, x, val, path, function(m, l, x, v, p)
                    {
                        typeof v[m] === "object" && P.trace("..;" + x, v[m], p + ";" + m);
                    });
                }
                else if (/,/.test(loc))
                { // [name1,name2,...]
                    for (var s = loc.split(/'?,'?/), i = 0, n = s.length; i < n; i++)
                        P.trace(s[i] + ";" + x, val, path);
                }
                else if (/^\(.*?\)$/.test(loc)) // [(expr)]
                    P.trace(P.eval(loc, val, path.substr(path.lastIndexOf(";") + 1)) + ";" + x, val, path);
                else if (/^\?\(.*?\)$/.test(loc)) // [?(expr)]
                    P.walk(loc, x, val, path, function(m, l, x, v, p)
                {
                    if (P.eval(l.replace(/^\?\((.*?)\)$/, "$1"), v[m], m)) P.trace(m + ";" + x, v, p);
                });
                else if (/^(-?[0-9]*):(-?[0-9]*):?([0-9]*)$/.test(loc)) // [start:end:step]  phyton slice syntax
                    P.slice(loc, x, val, path);
            }
            else
                P.store(path, val);
        },
        walk: function(loc, expr, val, path, f)
        {
            if (val instanceof Array)
            {
                for (var i = 0, n = val.length; i < n; i++)
                    if (i in val)
                        f(i, loc, expr, val, path);
            }
            else if (typeof val === "object")
            {
                for (var m in val)
                    if (val.hasOwnProperty(m))
                        f(m, loc, expr, val, path);
            }
        },
        slice: function(loc, expr, val, path)
        {
            if (val instanceof Array)
            {
                var len = val.length,
                    start = 0,
                    end = len,
                    step = 1;
                loc.replace(/^(-?[0-9]*):(-?[0-9]*):?(-?[0-9]*)$/g, function($0, $1, $2, $3)
                {
                    start = parseInt($1 || start);
                    end = parseInt($2 || end);
                    step = parseInt($3 || step);
                });
                start = (start < 0) ? Math.max(0, start + len) : Math.min(len, start);
                end = (end < 0) ? Math.max(0, end + len) : Math.min(len, end);
                for (var i = start; i < end; i += step)
                    P.trace(i + ";" + expr, val, path);
            }
        },
        eval: function(x, _v, _vname)
        {
            try
            {
                return $ && _v && eval(x.replace(/@/g, "_v"));
            }
            catch (e)
            {
                throw new SyntaxError("jsonPath: " + e.message + ": " + x.replace(/@/g, "_v").replace(/\^/g, "_a"));
            }
        }
    };

    var $ = obj;
    if (expr && obj && (P.resultType == "VALUE" || P.resultType == "PATH"))
    {
        P.trace(P.normalize(expr).replace(/^\$;/, ""), obj, "$");
        return P.result.length ? P.result : false;
    }
}