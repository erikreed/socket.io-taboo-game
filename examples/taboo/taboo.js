// Erik Reed
// taboo.js
// Much of this is from: https://github.com/LearnBoost/socket.io

var SPELL_CHECK = true;
var ROUND_TIME = 60; //seconds

var express = require('express')
  , stylus = require('stylus')
  , nib = require('nib')
  , sio = require('socket.io')
  , cards = require('./cards.js')
  , speller = require('./speller.js')
  , fs = require('fs');

if (SPELL_CHECK) 
   speller.train(fs.readFileSync((__dirname + "/dict.txt"), "ascii"));

var app = express.createServer();
var giver = null;
var players = 0;
var card = null;
var clients = {};
var scores = {};

app.configure(function () {
  app.use(stylus.middleware({ src: __dirname + '/public', compile: compile }))
  app.use(express.static(__dirname + '/public'));
  app.set('views', __dirname);
  app.set('view engine', 'jade');

  function compile (str, path) {
    return stylus(str)
      .set('filename', path)
      .use(nib());
  };
});


app.get('/', function (req, res) {
  res.render('index', { layout: false });
});

app.listen(8001, function () {
  var addr = app.address();
  console.log('   Taboo listening on http://' + addr.address + ':' + addr.port);
});

var io = sio.listen(app)
  , nicknames = {};


function checkGiver(socket) {
   var newGiver = false;
   if (players >= 2) {
      if (!giver) {
	 newGiver = true;
	 io.sockets.emit('announcement', 'Game started!');
      }
      else if (!nicknames[giver]) 
	 newGiver = true;
   }
   else {
      if (giver)
         io.sockets.emit('announcement', 'Waiting for more players to continue...');
      giver = null;
   }

   if (newGiver)
      setNewGiver();
   else
      io.sockets.emit('giver', giver ? giver.name : null);
}

function setNewGiver() {
  if (players < 2)
    return;
  var newGiver = getRandomName();
  giver = {name: newGiver, id: clients[newGiver]};
  io.sockets.emit('giver', giver.name);
  io.sockets.emit('announcement', 'New giver: ' + giver.name + 
	'. ' + ROUND_TIME + ' seconds left!');
  newCard();
  setTimeout(function() {
     if (players >= 2 && giver) {
	io.sockets.emit('announcement','Time\'s up ' + giver.name + '!');
	setNewGiver();
     }
  }, ROUND_TIME*1000);
}

function newCard() {
  card = getRandomCard();
  var id = clients[giver.name];
  io.sockets.sockets[id].emit('card', [card.word, card.taboo]);
}

function getRandomName() {
   return nicknames[randomKey(nicknames)];
}

function getRandomCard() {
   var card = cards.cards[randomKey(cards.cards)];
   console.log('new card: ' + card);
   return card;
}

io.sockets.on('connection', function (socket) {
  socket.on('user message', function (msg) {
      if (!giver) {
	  socket.broadcast.emit('user message', socket.nickname, msg);
      	  return;
      }
      if (socket.id === giver.id) {
	msg = msg.trim().toLowerCase();
	if (card.word === msg || contains(card.taboo, msg)) {
	   socket.emit('announcement', msg + ' is forbidden! Point deducted.');
	   socket.broadcast.emit('announcement', socket.nickname + 
		   ' said a Taboo word! Point deducted.');
	   scores[socket.nickname]--;
	   io.sockets.emit('scores', scores);
	   return;
	}
	if (SPELL_CHECK) {
	  var spellerCorrect = speller.correct(msg);
	  console.log(spellerCorrect);
	  if (spellerCorrect !== msg) {
	     socket.emit('announcement', msg + ' is not valid word.');
	        //if (spellerCorrect)
		//* suggestions aren't helpful *//
	  	//socket.emit('announcement', 'Maybe you meant: ' + 
		//	spellerCorrect + '?');
	     return;
	  }
	}	
        socket.broadcast.emit('user message', socket.nickname, msg);
      }
      // guess from non-giver
      else {
	socket.broadcast.emit('user message', socket.nickname, msg);
	if (msg === card.word) {
	  scores[socket.nickname]++;
	  scores[giver.name]++;
	  io.sockets.emit('announcement', socket.nickname + ' got it!');
	  io.sockets.emit('announcement', '+1 points for ' + socket.nickname +
	  	' and ' + giver.name);
	  io.sockets.emit('scores', scores);
	  newCard();
	}
      }

  });

  socket.on('giver', function(from) {
      socket.emit('giver', giver ? giver.name : null);
      if (giver)
	  socket.emit('announcement', 'The current giver is: ' + giver.name);
      else
	  socket.emit('announcement', 'Waiting for more players to continue...');
  });
  socket.on('scores', function(from) {
      socket.emit('scores', scores);
  });


  socket.on('nickname', function (nick, fn) {
    if (nicknames[nick]) {
      fn(true);
    } else {
      fn(false);
      nicknames[nick] = socket.nickname = nick;
      clients[nick] = socket.id;
      scores[nick] = 0;
      io.sockets.emit('announcement', nick + ' connected.');
      io.sockets.emit('scores', scores);
      players++;
      checkGiver(socket);
    }
  });

  socket.on('disconnect', function () {
    if (!socket.nickname) return;

    delete nicknames[socket.nickname];
    socket.broadcast.emit('announcement', socket.nickname + ' disconnected.');
    delete clients[socket.nickname];
    delete scores[socket.nickname];
    socket.broadcast.emit('scores', scores);
    players--;
    checkGiver(socket);
  });
});

// from  http://stackoverflow.com/questions/6643410/pick-random-value-from-associated-array-using-javascript
function randomKey(obj) {
  var ret;
  var c = 0;
  for (var key in obj)
      if (Math.random() < 1/++c)
	ret = key;
  return ret;
}

//from http://stackoverflow.com/questions/237104/javascript-array-containsobj
function contains(a, obj) {
  var i = a.length;
  while (i--) {
    if (a[i] === obj)
      return true;
  }
  return false;
}
