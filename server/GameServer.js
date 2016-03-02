// Library imports
var WebSocket = require('ws');
var fs = require("fs");
var ini = require('./modules/ini.js');
var http = require('http');

// Project imports
var Packet = require('./packet');
var PlayerTracker = require('./PlayerTracker');
var PacketHandler = require('./PacketHandler');
var Entity = require('./entity');
var Gamemode = require('./gamemodes');
var BotLoader = require('./ai/BotLoader.js');

// GameServer implementation
function GameServer(realmID, confile) {
    // Master server stuff
    this.realmID = realmID;
    this.masterServer;

    // Startup
    var adminArray = [];
    var nadminArray = [];
    this.run = true;
    this.lastNodeId = 1;
    this.lastPlayerId = 1;
    this.clients = [];
    this.nodes = [];
    this.nodesVirus = []; // Virus nodes
    this.nodesEjected = []; // Ejected mass nodes
    this.nodesPlayer = []; // Nodes controlled by players

    this.currentFood = 0;
    this.movingNodes = []; // For move engine
    this.leaderboard = [];
    this.lb_packet = new ArrayBuffer(0); // Leaderboard packet

    this.bots = new BotLoader(this);
    this.commands; // Command handler
    this.banned = []; // List of banned IPs

    // Main loop tick
    this.time = new Date();
    this.startTime = this.time;
    this.tick = 0; // 1 second ticks of mainLoop
    this.tickMain = 0; // 50 ms ticks, 20 of these = 1 leaderboard update
    this.tickSpawn = 0; // Used with spawning food

    // Config
    this.config = {
        serverName: "Cigar-Plus", // Name of the server for stats
        serverMaxConnections: 64, // Maximum amount of connections to the server.
        serverStatsPort: 1600, // Port for stats server. Having a negative number will disable the stats server.
        serverStatsUpdate: 60, // Amount of seconds per update for the server stats
        serverGamemode: 0, // Gamemode, 0 = FFA, 1 = Teams
        serverBots: 0, // Amount of player bots to spawn
        serverViewBase: 1024, // Base view distance of players. Warning: high values may cause lag
        serverLeaderboardLength: 10, // Maximum number of people on leaderboard
        serverMaxConnectionIP: 3, // Max amount of connections per IP
        serverRestartTime: 24, // How many hours before server restart
        useWithMaster: false, // Advanced.
        masterIP: "127.0.0.1", // Advanced.
        masterCommands: false, // Advanced.
        masterUpdate: 45, // Advanced.
        adminConfig: 0, // Turn on or off the use of admin configurations. (1 is on - 0 is off)
        adminNames: "", // The name a user would have to use to register as an admin.
        adminNewNames: "", // The name you will be changed to when using adminNames.
        adminStartMass: 500, // Amount of mass the admins start with.
        borderLeft: 0, // Left border of map (Vanilla value: 0)
        borderRight: 6000, // Right border of map (Vanilla value: 11180.3398875)
        borderTop: 0, // Top border of map (Vanilla value: 0)
        borderBottom: 6000, // Bottom border of map (Vanilla value: 11180.3398875)
        chatMaxMessageLength: 70, // Length of messages in chat
        chatIntervalTime: 2500, // ms between each message.
        spawnInterval: 20, // The interval between each food cell spawn in ticks (1 tick = 50 ms)
        foodSpawnAmount: 10, // The amount of food to spawn per interval
        foodStartAmount: 100, // The starting amount of food in the map
        foodMaxAmount: 500, // Maximum food cells on the map
        foodMass: 1, // Starting food size (In mass)
        virusMinAmount: 10, // Minimum amount of viruses on the map.
        virusMaxAmount: 50, // Maximum amount of viruses on the map. If this amount is reached, then ejected cells will pass through viruses.
        virusStartMass: 100, // Starting virus size (In mass)
        virusFeedAmount: 7, // Amount of times you need to feed a virus to shoot it
        ejectMass: 12, // Mass of ejected cells
        ejectMassLoss: 16, // Mass lost when ejecting cells
        ejectSpeed: 160, // Base speed of ejected cells
        ejectSpawnPlayer: 50, // Chance for a player to spawn from ejected mass
        ejectMassCooldown: 200, // Eject mass cooldown
        playerStartMass: 10, // Starting mass of the player cell.
        playerMaxMass: 22500, // Maximum mass a player can have
        playerMinMassEject: 32, // Mass required to eject a cell
        playerMinMassSplit: 36, // Mass required to split
        playerMaxCells: 16, // Max cells the player is allowed to have
        playerRecombineTime: 30, // Base amount of seconds before a cell is allowed to recombine
        playerMassDecayRate: .002, // Amount of mass lost per second
        playerMinMassDecay: 9, // Minimum mass for decay to occur
        playerMaxNickLength: 15, // Maximum nick length
        playerDisconnectTime: 60, // The amount of seconds it takes for a player cell to be removed after disconnection (If set to -1, cells are never removed)
        playerSpeed: 30, // Speed of the player cells.
        playerFDMultiplier: 2, // Fast decay multiplier
        playerFDMass: 5000, // Mass to start fast decay at.
        tourneyMaxPlayers: 12, // Maximum amount of participants for tournament style game modes
        tourneyPrepTime: 10, // Amount of ticks to wait after all players are ready (1 tick = 1000 ms)
        tourneyEndTime: 30, // Amount of ticks to wait after a player wins (1 tick = 1000 ms)
        tourneyAutoFill: 0, // If set to a value higher than 0, the tournament match will automatically fill up with bots after this amount of seconds
        tourneyAutoFillPlayers: 1, // The timer for filling the server with bots will not count down unless there is this amount of real players
    };
    // Parse config
    this.loadConfig(confile);
    this.gameMode = Gamemode.get(this.config.serverGamemode);

    // Debug
    this.debug = false;
    this.tickDebug = 0;
}

module.exports = GameServer;

GameServer.prototype.start = function() {
    // Gamemode configurations
    this.gameMode.onServerInit(this);

    // Start the server
    this.socketServer = new WebSocket.Server({
        port: this.config.serverPort,
        perMessageDeflate: false
    }, function() {
        // Spawn starting food
        this.startingFood();

        // Start Main Loop
        setInterval(this.mainLoop.bind(this), 1);

        // Done
        console.log("[Game:" + this.realmID + "] Game Server started at port %d", this.config.serverPort);
        console.log("[Game:" + this.realmID + "] Stats Server started at port %d", this.config.serverStatsPort);
        console.log("[Game:" + this.realmID + "] Current game mode is " + this.gameMode.name);

        // Player bots (Experimental)
        if (this.config.serverBots > 0) {
            for (var i = 0; i < this.config.serverBots; i++) {
                this.bots.addBot();
            }
            console.log("[Game:" + this.realmID + "] Loaded " + this.config.serverBots + " player bots");
        }
    }.bind(this));

    this.socketServer.on('connection', connectionEstablished.bind(this));

    // Properly handle errors because some people are too lazy to read the readme
    this.socketServer.on('error', function err(e) {
        switch (e.code) {
            case "EADDRINUSE":
                console.log("[Error] Server could not bind to port! Please close out of Skype or change 'serverPort' in gameserver.ini to a different number.");
                break;
            case "EACCES":
                console.log("[Error] Please make sure you are running Ogar with root privileges.");
                break;
            default:
                console.log("[Error] Unhandled error code: " + e.code);
                break;
        }
        process.exit(1); // Exits the program
    });

    function connectionEstablished(ws) {
        if (this.config.serverMaxConnectionIP > 0) {
            for (var cons = 1, i = 0, llen = this.clients.length; i < llen; i++) {
                if (this.clients[i].remoteAddress == ws._socket.remoteAddress) {
                    cons++;
                }
            }
            if (cons > this.config.serverMaxConnectionIP ) {
                ws.close();
                return;
            }
        }
        if (this.clients.length > this.config.serverMaxConnections) { // Server full
            ws.close();
            console.log("[Game:" + this.realmID + "] Client tried to connect, but server player limit has been reached!");
            return;
        } else if (this.banned.indexOf(ws._socket.remoteAddress) != -1) { // Banned
            ws.close();
            return;
        }

        // Master server stuff
        if ((this.config.masterIP == ws._socket.remoteAddress) && (!this.masterServer) && (this.config.useWithMaster)) {
            ws.gameServer = this;

            ws.on('message', function recv(msg) {
                if (msg.charAt(0) == 'H') {
                    ws.gameServer.realmID = parseInt(msg.split('Hi')[1]);
                    ws.send('Hello'); // Response
                    console.log(ws.gameServer.getName() + " Connected to master server");
                    // Send stats
                    var stats = {
                        players: ws.gameServer.clients.length,
                        max: ws.gameServer.config.serverMaxConnections,
                        mode: ws.gameServer.gameMode.name,
                    };
                    ws.gameServer.masterServer.send(JSON.stringify(stats));
                    // Connection established
                    if (ws.gameServer.config.masterCommands) {
                        // Override
                        ws.on('message', function recv(msg) {
                            var split = msg.split(' ');
                            var execute = ws.gameServer.commands[split[0]];
                            if (execute) {
                                execute(ws.gameServer, split);
                            } else {
                                console.log(ws.gameServer.getName() + " Invalid command!");
                            }
                        });
                    } else {
                        ws.on('message', function recv(msg) { /* Nothing */ });
                    }
                }
            });

            this.masterServer = ws;

            this.masterServer.timer = setInterval(function() {
                try {
                    var stats = {
                        players: this.clients.length,
                        max: this.config.serverMaxConnections,
                        mode: this.gameMode.name,
                    };
                    this.masterServer.send(JSON.stringify(stats));
                } catch (e) {
                    console.log(this.getName() + " Master server disconnected!");
                    clearInterval(this.masterServer.timer);
                    this.masterServer.close();
                    this.masterServer = null;
                }
            }.bind(this), this.config.masterUpdate * 1000);
            return;
        }

        // Back to game server stuff
        function close(error) {
            //console.log("[Game] Disconnect: "+error);

            var client = this.socket.playerTracker;
            var len = this.socket.playerTracker.cells.length;
            for (var i = 0; i < len; i++) {
                var cell = this.socket.playerTracker.cells[i];

                if (!cell) {
                    continue;
                }

                cell.disconnect = this.server.config.playerDisconnectTime;
                cell.calcMove = function() {
                    return;
                }; // Clear function so that the cell cant move
                //this.server.removeNode(cell);
            }

            var index = this.server.clients.indexOf(this.socket);
            if (index != -1) {
                this.server.clients.splice(index, 1);
            }
        }

        // console.log("[Game] Connect: %s:%d", ws._socket.remoteAddress, ws._socket.remotePort);
        ws.remoteAddress = ws._socket.remoteAddress;
        ws.remotePort = ws._socket.remotePort;
        ws.playerTracker = new PlayerTracker(this, ws);
        ws.packetHandler = new PacketHandler(this, ws);
        ws.on('message', ws.packetHandler.handleMessage.bind(ws.packetHandler));

        var bindObject = {
            server: this,
            socket: ws
        };
        ws.on('error', close.bind(bindObject));
        ws.on('close', close.bind(bindObject));
        this.clients.push(ws);
    }
    this.startStatsServer(this.config.serverStatsPort);
};

GameServer.prototype.getName = function() {
    // Gets the name of this server. For use in the console
    return "[Game:" + this.realmID + "]";
}

GameServer.prototype.getMode = function() {
    return this.gameMode;
};

GameServer.prototype.getNextNodeId = function() {
    // Resets integer
    if (this.lastNodeId > 2147483647) {
        this.lastNodeId = 1;
    }
    return this.lastNodeId++;
};

GameServer.prototype.getNewPlayerID = function() {
    // Resets integer
    if (this.lastPlayerId > 2147483647) {
        this.lastPlayerId = 1;
    }
    return this.lastPlayerId++;
};

GameServer.prototype.getRandomPosition = function() {
    return {
        x: Math.floor(Math.random() * (this.config.borderRight - this.config.borderLeft)) + this.config.borderLeft,
        y: Math.floor(Math.random() * (this.config.borderBottom - this.config.borderTop)) + this.config.borderTop
    };
};

GameServer.prototype.getRandomColor = function() {
    var colorRGB = [0xFF, 0x07, ((Math.random() * (256 - 7)) >> 0) + 7];
    colorRGB.sort(function () {
        return 0.5 - Math.random()
    });

    return {
        r: colorRGB[0],
        b: colorRGB[1],
        g: colorRGB[2]
    };
};

GameServer.prototype.exitServer = function() {
    console.log("[Game:" + this.realmID + "] Server shutting down.")
    this.socketServer.close();
    process.exit(1);
    window.close();
}

GameServer.prototype.addNode = function(node) {
    this.nodes.push(node);

    // Adds to the owning player's screen
    if (node.owner) {
        node.setColor(node.owner.color);
        node.owner.cells.push(node);
        node.owner.socket.sendPacket(new Packet.AddNode(node));
    }

    // Special on-add actions
    node.onAdd(this);

    // Add to visible nodes
    for (var i = 0; i < this.clients.length; i++) {
        client = this.clients[i].playerTracker;
        if (!client) {
            continue;
        }

        // client.nodeAdditionQueue is only used by human players, not bots
        // for bots it just gets collected forever, using ever-increasing amounts of memory
        if ('_socket' in client.socket && node.visibleCheck(client.viewBox, client.centerPos)) {
            client.nodeAdditionQueue.push(node);
        }
    }
};

GameServer.prototype.removeNode = function(node) {
    // Remove from main nodes list
    var index = this.nodes.indexOf(node);
    if (index != -1) {
        this.nodes.splice(index, 1);
    }

    // Remove from moving cells list
    index = this.movingNodes.indexOf(node);
    if (index != -1) {
        this.movingNodes.splice(index, 1);
    }

    // Special on-remove actions
    node.onRemove(this);

    // Animation when eating
    for (var i = 0; i < this.clients.length; i++) {
        client = this.clients[i].playerTracker;
        if (!client) {
            continue;
        }
        // Remove from client
        client.nodeDestroyQueue.push(node);
    }
};

GameServer.prototype.cellTick = function() {
    // Move cells
    this.updateMoveEngine();
}

GameServer.prototype.spawnTick = function() {
    // Spawn food
    this.tickSpawn++;
    if (this.tickSpawn >= this.config.spawnInterval) {
        this.updateFood(); // Spawn food
        this.virusCheck(); // Spawn viruses

        this.tickSpawn = 0; // Reset
    }
}

GameServer.prototype.gamemodeTick = function() {
    // Gamemode tick
    this.gameMode.onTick(this);
}

GameServer.prototype.cellUpdateTick = function() {
    // Update cells
    this.updateCells();
}


GameServer.prototype.mainLoop = function() {
    // Timer
    var local = new Date();
    this.tick += (local - this.time);
    this.time = local;

    if (this.tick >= 50) {
        // Loop main functions
        if (this.run) {
            setTimeout(this.cellTick(), 0);
            setTimeout(this.spawnTick(), 0);
            setTimeout(this.gamemodeTick(), 0);
        }

        // Update the client's maps
        this.updateClients();

        // Update cells/leaderboard loop
        this.tickMain++;
        if (this.tickMain >= 20) { // 1 Second
            setTimeout(this.cellUpdateTick(), 0);

            // Update leaderboard with the gamemode's method
            this.leaderboard = [];
            this.gameMode.updateLB(this);
            this.lb_packet = new Packet.UpdateLeaderboard(this.leaderboard,this.gameMode.packetLB);

            this.tickMain = 0; // Reset
        }

        // Debug
        //console.log(this.tick - 50);

        // Reset
        this.tick = 0;
    }
};


GameServer.prototype.updateClients = function() {
    for (var i = 0; i < this.clients.length; i++) {
        if (typeof this.clients[i] == "undefined") {
            continue;
        }

        this.clients[i].playerTracker.update();
    }
};

GameServer.prototype.startingFood = function() {
    // Spawns the starting amount of food cells
    for (var i = 0; i < this.config.foodStartAmount; i++) {
        this.spawnFood();
    }
};

GameServer.prototype.updateFood = function() {
    var toSpawn = Math.min(this.config.foodSpawnAmount, (this.config.foodMaxAmount - this.currentFood));
    for (var i = 0; i < toSpawn; i++) {
        this.spawnFood();
    }
};

GameServer.prototype.spawnFood = function() {
    var f = new Entity.Food(this.getNextNodeId(), null, this.getRandomPosition(), this.config.foodMass);
    f.setColor(this.getRandomColor());

    this.addNode(f);
    this.currentFood++;
};

GameServer.prototype.spawnPlayer = function(player, pos, mass) {
    var isAdmin = false;
    // Check for config
    if (this.config.adminConfig == 1) {
        adminArray = this.config.adminNames.split(";");
        nadminArray = this.config.adminNewNames.split(";");
        var ii = 0;
        function checkAdmin() {
            if (ii !== adminArray.length) {
                if (player.name == adminArray[ii]) {
                    isAdmin = true;
                    console.log("[Master] " + nadminArray[ii] + " has successfully logged in using " + adminArray[ii]);
                } else {
                    ii = ii + 1;
                    checkAdmin();
                }
            }
        }
        checkAdmin();
    }

    if (pos == null) { // Get random pos
        pos = this.getRandomPosition();
    }

    if (mass == null) { // Get starting mass
        mass = this.config.playerStartMass;
    }

    // Spawn player and add to world
    if (isAdmin == true) {
        player.name = nadminArray[ii];
        var cell = new Entity.PlayerCell(this.getNextNodeId(), player, pos, this.config.adminStartMass);
    } else {
        var cell = new Entity.PlayerCell(this.getNextNodeId(), player, pos, mass);
    }

    this.addNode(cell);

    // Set initial mouse coords
    player.mouse = {
        x: pos.x,
        y: pos.y
    };
};

GameServer.prototype.virusCheck = function() {
    // Checks if there are enough viruses on the map
    if (this.nodesVirus.length < this.config.virusMinAmount) {
        // Spawns a virus
        var pos = this.getRandomPosition();

        // Check for players
        for (var i = 0; i < this.nodesPlayer.length; i++) {
            var check = this.nodesPlayer[i];

            if (check.mass < this.config.virusStartMass) {
                continue;
            }

            var r = check.getSize(); // Radius of checking player cell

            // Collision box
            var topY = check.position.y - r;
            var bottomY = check.position.y + r;
            var leftX = check.position.x - r;
            var rightX = check.position.x + r;

            // Check for collisions
            if (pos.y > bottomY) {
                continue;
            }

            if (pos.y < topY) {
                continue;
            }

            if (pos.x > rightX) {
                continue;
            }

            if (pos.x < leftX) {
                continue;
            }

            // Collided
            return;
        }

        // Spawn if no cells are colliding
        var v = new Entity.Virus(this.getNextNodeId(), null, pos, this.config.virusStartMass);
        this.addNode(v);
    }
};

GameServer.prototype.getDist = function(x1, y1, x2, y2){ // Use Pythagoras theorem
    var deltaX = Math.abs(x1 - x2);
    var deltaY = Math.abs(y1 - y2);
    return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
}

GameServer.prototype.updateMoveEngine = function() {
    // Move player cells
    var len = this.nodesPlayer.length;

    // Sort cells to move the cells close to the mouse first
    var srt = [];
    for (var i = 0; i < len; i++)
    srt[i] = i;

    for (var i = 0; i < len; i++){
    for (var j = i + 1; j < len; j++){
        var clientI = this.nodesPlayer[srt[i]].owner;
        var clientJ = this.nodesPlayer[srt[j]].owner;
        if (this.getDist( this.nodesPlayer[srt[i]].position.x, this.nodesPlayer[srt[i]].position.y, clientI.mouse.x, clientI.mouse.y ) >
        this.getDist( this.nodesPlayer[srt[j]].position.x, this.nodesPlayer[srt[j]].position.y, clientJ.mouse.x, clientJ.mouse.y )){
        var aux = srt[i];
        srt[i] = srt[j];
        srt[j] = aux;
        }
    }
    }

    for (var i = 0; i < len; i++) {
        var cell = this.nodesPlayer[srt[i]];

        // Do not move cells that have already been eaten or have collision turned off
        if (!cell){
            continue;
        }

        var client = cell.owner;

        cell.calcMove(client.mouse.x, client.mouse.y, this);

        // Check if cells nearby
        var list = this.getCellsInRange(cell);
        for (var j = 0; j < list.length ; j++) {
            var check = list[j];

            // if we're deleting from this.nodesPlayer, fix outer loop variables; we need to update its length, and maybe 'i' too
            if (check.cellType == 0) {
                len--;
                if (check.nodeId < cell.nodeId) {
                    i--;
                }
            }

            // Consume effect
            check.onConsume(cell,this);

            // Remove cell
            check.setKiller(cell);
            this.removeNode(check);
        }
    }

    // A system to move cells not controlled by players (ex. viruses, ejected mass)
    len = this.movingNodes.length;
    for (var i = 0; i < len; i++) {
        var check = this.movingNodes[i];

        // Recycle unused nodes
        while ((typeof check == "undefined") && (i < this.movingNodes.length)) {
            // Remove moving cells that are undefined
            this.movingNodes.splice(i, 1);
            check = this.movingNodes[i];
        }

        if (i >= this.movingNodes.length) {
            continue;
        }

        if (check.moveEngineTicks > 0) {
            check.onAutoMove(this);
            // If the cell has enough move ticks, then move it
            check.calcMovePhys(this.config);
        } else {
            // Auto move is done
            check.moveDone(this);
            // Remove cell from list
            var index = this.movingNodes.indexOf(check);
            if (index != -1) {
                this.movingNodes.splice(index, 1);
            }
        }
    }
};

GameServer.prototype.setAsMovingNode = function(node) {
    this.movingNodes.push(node);
};

GameServer.prototype.formatTime = function () {
    var hour = this.time.getHours();
    hour = (hour < 10 ? "0" : "") + hour;

    var min = this.time.getMinutes();
    min = (min < 10 ? "0" : "") + min;

    return hour + ":" + min;
};

GameServer.prototype.splitCells = function(client) {
    var len = client.cells.length;
    for (var i = 0; i < len; i++) {
        if (client.cells.length >= this.config.playerMaxCells) {
            // Player cell limit
            continue;
        }

        var cell = client.cells[i];
        if (!cell) {
            continue;
        }

        if (cell.mass < this.config.playerMinMassSplit) {
            continue;
        }

        // Get angle
        var deltaY = client.mouse.y - cell.position.y;
        var deltaX = client.mouse.x - cell.position.x;
        var angle = Math.atan2(deltaX, deltaY);

        // Get starting position
        var size = cell.getSize() / 2;
        var startPos = {
            x: cell.position.x,
            y: cell.position.y
        };
        // Calculate mass and speed of splitting cell
        var newMass = cell.mass / 2;
        cell.mass = newMass;
        // Create cell
        var split = new Entity.PlayerCell(this.getNextNodeId(), client, startPos, newMass, this);
        split.setAngle(angle);
        var splitSpeed = 130;
        split.setMoveEngineData(splitSpeed, 32, 0.85); //vanilla agar.io = 130, 32, 0.85
        split.calcMergeTime(this.config.playerRecombineTime);
        split.ignoreCollision = true;
        split.restoreCollisionTicks = 10; //vanilla agar.io = 10

        // Add to moving cells list
        this.setAsMovingNode(split);
        this.addNode(split);
    }
};

GameServer.prototype.ejectMass = function(client) {
    if (typeof client.lastEject == 'undefined' || this.time - client.lastEject >= this.config.ejectMassCooldown) {
        for (var i = 0, llen = client.cells.length; i < llen; i++) {
            var cell = client.cells[i];
            if ( (!cell) || (cell.mass < this.config.playerMinMassEject)) {
                continue;
            }
            var deltaY = client.mouse.y - cell.position.y;
            var deltaX = client.mouse.x - cell.position.x;
            var angle = Math.atan2(deltaX, deltaY);

            // Get starting position
            var size = cell.getSize() + 5;
            var startPos = {
                x: cell.position.x + ( (size + this.config.ejectMass) * Math.sin(angle) ),
                y: cell.position.y + ( (size + this.config.ejectMass) * Math.cos(angle) )
            };

            // Remove mass from parent cell
            cell.mass -= this.config.ejectMassLoss;
            // Randomize angle
            angle += (Math.random() * 0.4) - 0.2;

            // Create cell
            var ejected = new Entity.EjectedMass(this.getNextNodeId(), null, startPos, this.config.ejectMass);
            ejected.setAngle(angle);
            ejected.setMoveEngineData(this.config.ejectSpeed, 20);
            ejected.setColor(cell.getColor());

            this.addNode(ejected);
            this.setAsMovingNode(ejected);
            client.lastEject = this.time;
        }
    }
};

GameServer.prototype.newCellVirused = function(client, parent, angle, mass, speed) {
    // Starting position
    var startPos = {
        x: parent.position.x,
        y: parent.position.y
    };

    // Create cell
    newCell = new Entity.PlayerCell(this.getNextNodeId(), client, startPos, mass);
    newCell.setAngle(angle);
    newCell.setMoveEngineData(speed, 15);
    newCell.calcMergeTime(this.config.playerRecombineTime);
    newCell.ignoreCollision = true; // Turn off collision

    // Add to moving cells list
    this.addNode(newCell);
    this.setAsMovingNode(newCell);
};

GameServer.prototype.shootVirus = function(parent) {
    var parentPos = {
        x: parent.position.x,
        y: parent.position.y,
    };

    var newVirus = new Entity.Virus(this.getNextNodeId(), null, parentPos, this.config.virusStartMass);
    newVirus.setAngle(parent.getAngle());
    newVirus.setMoveEngineData(200, 20);

    // Add to moving cells list
    this.addNode(newVirus);
    this.setAsMovingNode(newVirus);
};

GameServer.prototype.getCellsInRange = function(cell) {
    var list = new Array();
    var r = cell.getSize(); // Get cell radius (Cell size = radius)

    var topY = cell.position.y - r;
    var bottomY = cell.position.y + r;

    var leftX = cell.position.x - r;
    var rightX = cell.position.x + r;

    // Loop through all cells that are visible to the cell. There is probably a more efficient way of doing this but whatever
    var len = cell.owner.visibleNodes.length;
    for (var i = 0; i < len; i++) {
        var check = cell.owner.visibleNodes[i];

        if (typeof check === 'undefined') {
            continue;
        }

        // if something already collided with this cell, don't check for other collisions
        if (check.inRange) {
            continue;
        }

        // Can't eat itself
        if (cell.nodeId == check.nodeId) {
            continue;
        }

        // Can't eat cells that have collision turned off
        if ((cell.owner == check.owner) && (cell.ignoreCollision)) {
            continue;
        }

        // AABB Collision
        if (!check.collisionCheck2(squareR, cell.position)) {
            continue;
        }

        // Cell type check - Cell must be bigger than this number times the mass of the cell being eaten
        var multiplier = 1.25;

        switch (check.getType()) {
            case 1: // Food cell
                list.push(check);
                check.inRange = true; // skip future collision checks for this food
                continue;
            case 2: // Virus
                multiplier = 1.33;
                break;
            case 0: // Players
                // Can't eat self if it's not time to recombine yet
                if (check.owner == cell.owner) {
                    if ((cell.recombineTicks > 0) || (check.recombineTicks > 0)) {
                        continue;
                    }

                    multiplier = 1.00;
                }

                // Can't eat team members
                if (this.gameMode.haveTeams) {
                    if (!check.owner) { // Error check
                        continue;
                    }

                    if ((check.owner != cell.owner) && (check.owner.getTeam() == cell.owner.getTeam())) {
                        continue;
                    }
                }
                break;
            default:
                break;
        }

        // Make sure the cell is big enough to be eaten.
        if ((check.mass * multiplier) > cell.mass) {
            continue;
        }

        // Eating range
        var xs = Math.pow(check.position.x - cell.position.x, 2);
        var ys = Math.pow(check.position.y - cell.position.y, 2);
        var dist = Math.sqrt(xs + ys);

        var eatingRange = cell.getSize() - check.getEatingRange(); // Eating range = radius of eating cell + 40% of the radius of the cell being eaten
        if (dist > eatingRange) {
            // Not in eating range
            continue;
        }

        // Add to list of cells nearby
        list.push(check);

        // Something is about to eat this cell; no need to check for other collisions with it
        check.inRange = true;
    }
    return list;
};

GameServer.prototype.getNearestVirus = function(cell) {
    // More like getNearbyVirus
    var virus = null;
    var r = 100; // Checking radius

    var topY = cell.position.y - r;
    var bottomY = cell.position.y + r;

    var leftX = cell.position.x - r;
    var rightX = cell.position.x + r;

    // Loop through all viruses on the map. There is probably a more efficient way of doing this but whatever
    var len = this.nodesVirus.length;
    for (var i = 0; i < len; i++) {
        var check = this.nodesVirus[i];

        if (typeof check === 'undefined') {
            continue;
        }

        if (!check.collisionCheck(bottomY, topY, rightX, leftX)) {
            continue;
        }

        // Add to list of cells nearby
        virus = check;
        break;
    }
    return virus;
};

GameServer.prototype.updateCells = function() {
    if (!this.run) {
        // Server is paused
        return;
    }
    // Loop through all player cells
    var massDecay = 1 - (this.config.playerMassDecayRate * this.gameMode.decayMod);
    for (var i = 0; i < this.nodesPlayer.length; i++) {
        var cell = this.nodesPlayer[i];

        if (!cell) {
            continue;
        }

        if (cell.disconnect > -1) {
            // Player has disconnected... remove it when the timer hits -1
            cell.disconnect--;
            if (cell.disconnect == -1) {
                this.removeNode(cell);
                continue;
            }
        } else if (cell.recombineTicks > 0) {
            // Recombining
            cell.recombineTicks--;
        }

        // Mass decay
        if (cell.mass >= this.config.playerFDMass) {
            cell.mass *= massDecay - (this.config.playerFDMultiplier / 500);
        } else {
            cell.mass *= massDecay;
        }
    }
};

GameServer.prototype.loadConfig = function(confile) {
    try {
        // Load the contents of the config file
        var load = ini.parse(fs.readFileSync(confile, 'utf-8'));

        // Replace all the default config's values with the loaded config's values
        for (var obj in load) {
            this.config[obj] = load[obj];
        }
    } catch (err) {
        // No config
        console.log("[Game:" + this.realmID + "] Config not found... Generating new config");

        // Create a new config
        fs.writeFileSync(confile, ini.stringify(this.config));
    }
};

GameServer.prototype.startStatsServer = function(port) {
    // Do not start the server if the port is negative
    if (port < 1) {
        return;
    }

    // Create stats
    this.stats = "Test";
    this.getStats();

    // Show stats
    this.httpServer = http.createServer(function(req, res) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.writeHead(200);
        res.end(this.stats);
    }.bind(this));

    this.httpServer.listen(port, function() {
        // Stats server
        setInterval(this.getStats.bind(this), this.config.serverStatsUpdate * 1000);
    }.bind(this));
};

GameServer.prototype.getStats = function() {
    var players = 0;
    this.clients.forEach(function(client) {
        if (client.playerTracker && client.playerTracker.cells.length > 0)
            players++;
    });
    var s = {
        'name': this.config.serverName,
        'current_players': this.clients.length,
        'alive': players,
        'spectators': this.clients.length - players,
        'max_players': this.config.serverMaxConnections,
        'gamemode': this.gameMode.name,
        'start_time': this.startTime
    };
    this.stats = JSON.stringify(s);
};

GameServer.prototype.switchSpectator = function(player) {
    if (this.gameMode.specByLeaderboard) {
        player.spectatedPlayer++;
        if (player.spectatedPlayer == this.leaderboard.length) {
            player.spectatedPlayer = 0;
        }
    } else {
        // Find next non-spectator with cells in the client list
        var oldPlayer = player.spectatedPlayer + 1;
        var count = 0;
        while (player.spectatedPlayer != oldPlayer && count != this.clients.length) {
            if (oldPlayer == this.clients.length) {
                oldPlayer = 0;
                continue;
            }

            if (!this.clients[oldPlayer]) {
                // Break out of loop in case client tries to spectate an undefined player
                player.spectatedPlayer = -1;
                break;
            }

            if (this.clients[oldPlayer].playerTracker.cells.length > 0) {
                break;
            }

            oldPlayer++;
            count++;
        }
        if (count == this.clients.length) {
            player.spectatedPlayer = -1;
        } else {
            player.spectatedPlayer = oldPlayer;
        }
    }
};

// Custom prototype functions
WebSocket.prototype.sendPacket = function(packet) {
    function getBuf(data) {
        var array = new Uint8Array(data.buffer || data);
        var l = data.byteLength || data.length;
        var o = data.byteOffset || 0;
        var buffer = new Buffer(l);

        for (var i = 0; i < l; i++) {
            buffer[i] = array[o + i];
        }

        return buffer;
    }

    //if (this.readyState == WebSocket.OPEN && (this._socket.bufferSize == 0) && packet.build) {
    if (this.readyState == WebSocket.OPEN && packet.build) {
        var buf = packet.build();
        this.send(getBuf(buf), {binary: true});
    } else if (!packet.build) {
        // Do nothing
    } else {
        this.readyState = WebSocket.CLOSED;
        this.emit('close');
        this.removeAllListeners();
    }
};