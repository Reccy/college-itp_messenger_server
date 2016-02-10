/* Initialize pubnub and channel management */
var pubnub = require("pubnub")(
{
    ssl: true, // <- enable TLS Tunneling over TCP
    publish_key: "pub-c-0932089b-8fc7-4329-b03d-7c47fe828971",
    subscribe_key: "sub-c-a91c35f6-ca98-11e5-a9b2-02ee2ddab7fe",
    heartbeat: 30,
    uuid: "SERVER"
});

/* Variables to manage channel */
var globalChannel = "itp_test_channel_nodejs";
var nextChannel = "chan_temp";
var channelList = [];

/* Function to broadcast the next channel and subscribe to next channel */
function broadcastNextChannel(client_uuid)
{
    /* Create the channel name based off of the timestamp */
    nextChannel = "chan_" + client_uuid;
    var alreadyOnList;
    
    for(i = 0; i < channelList.length; i++)
    {
        if(channelList[i].uuid === client_uuid)
        {
            alreadyOnList = true;
        }
    }
    
    if(!alreadyOnList)
    {
        channelList.push(
        {
            "uuid": client_uuid,
            "chan": nextChannel
        });
    }
    
    /* Package the nextChannel into a JSON object, of type "initial connect" */
    var msg = (
    {
        "m_type": "i_connect",
        "uuid": client_uuid,
        "channel": nextChannel
    });
    console.log(" > [" + globalChannel + "] BROADCASTING NEXT CHANNEL: " + JSON.stringify(msg));

    /* Send the nextChannel message across the global channel */
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

    /* Subscribe to the nextChannel */
    console.log(" > [PRIVATE CHANNEL] ATTEMPTING CONNECTION...");
    pubnub.subscribe(
    {
        channel: nextChannel,
        message: function(m)
        {
            console.log(" > [PRIVATE CHANNEL] MESSAGE RECEIVED: " + JSON.stringify(m));
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

/* DEBUG FUNCTIONS START */

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
            console.log("UUID: " + channelList[i].uuid + " | CHAN: " + channelList[i].chan);
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
                        console.log(" > SHUTDOWN COMPLETE!");
                        process.exit(0);
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

/* DEBUG FUNCTIONS END */

/* SERVER START */

console.log(" > [" + globalChannel + "] ATTEMPTING CONNECTION...");

/* Create GLOBAL CHANNEL */
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