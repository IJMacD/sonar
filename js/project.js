(function($,window){

var GameObject = {},
	GameComponent = {},
	GameObjectManager = Object.create(GameObject);

function makeGameObject(){
	var o = Object.create(GameObject);
	o.x = 0;
	o.y = 0;
	o.components = [];
	return o;
}

GameObject.update = function(time) {
	for (var i = 0, l = this.components.length; i < l; i++) {
		this.components[i].update(time, this);
	};
};

GameComponent.update = function(time, parent){};

function makeGameObjectManager(){
	var o = Object.create(GameObjectManager);
	o.x = 0;
	o.y = 0;
	o.components = [];
	o.objects = [];
	return o;
}
GameObjectManager.update = function(time) {
	GameObject.update.call(this, time);

	for (var i = 0, l = this.objects.length; i < l; i++) {
		this.objects[i].update(time);
	};
}
	Array.prototype.remove = function(from, to) {
		var rest = this.slice((to || from) + 1 || this.length);
		this.length = from < 0 ? this.length + from : from;
		return this.push.apply(this, rest);
	};

$(function(){
		// Constants
	var BOARD_RATIO = 1/2,	// Width:Height  -- 1:(Height/Width)
		STOPPED = 0,
		PAUSED = 1,
		RUNNING = 2,

		// DOM
		gameBoard,
		canvasWidth,
		canvasHeight,
		context,
		audioContext,
		gridSize = 32,
		actualGridX,
		actualGridY,

		// Resources
		buoyImage,
		buoyImageOff,
		chestImage,
		sonarPing,
		treasureSound,

		// Components
		RadarRenderComponent,
		AnimatedRadarComponent,
		SpriteComponent,
		AnimatedSpriteComponent,
		RadarScoreComponent,

		// State
		gameState = RUNNING,
		gameObjectManager,
		buoys = [],
		treasures = [],
		treasuresLeft = 5;

	defineComponents();

	bootstrapCanvas();
	bootstrapResources();
	bootstrapGameGraph();
	gameLoop(0);

	function defineComponents(){
		RadarRenderComponent = Object.create(GameComponent);
		RadarRenderComponent.update = function(time, parent){
			context.save();
			context.beginPath();
			context.arc(parent.x, parent.y, parent.radarSize*10, 0, Math.PI*2, false);
			context.strokeStyle = "#ff0000";
			context.stroke();
			context.restore();
		}
		AnimatedRadarRenderComponent = Object.create(GameComponent);
		AnimatedRadarRenderComponent.update = function(time, parent){
			var brightness;
			if(parent.radarSize < this.maxSize){
				context.save();
				if(this.lastTime > 0){
					this.size += (time - this.lastTime) * this.speed * this.maxSize / 1000;
					brightness = Math.max(0.4*(this.maxSize - this.size)/this.maxSize,1-Math.pow((this.size - parent.radarSize)*0.3,2));
					context.strokeStyle = "rgba(255,0,0,"+brightness+")";
					if(this.size > this.maxSize){
						this.size = 0;
						this.lastBrightness = 0;
						this.pinged = false;
					}
					if(!this.pinged && this.size >= 1 && brightness > this.lastBrightness){
						playSonarPing();
						this.pinged = true;
					}
					this.lastBrightness = brightness;
				}
				this.lastTime = time;
				context.beginPath();
				context.arc(parent.x, parent.y, this.size, 0, Math.PI*2, false);
				context.lineWidth = 3;
				context.stroke();
				context.restore();
			}
		}
		SpriteComponent = Object.create(GameComponent);
		SpriteComponent.update = function(time, parent) {
			context.drawImage(this.image, parent.x - this.iw / 2, parent.y - this.ih / 2, this.iw, this.ih);
		}
		AnimatedSpriteComponent = Object.create(GameComponent);
		AnimatedSpriteComponent.update = function(time, parent) {
			context.drawImage(this.image, parent.x - this.cx, parent.y - this.cy, this.iw, this.ih);
			if(this.lastChange == 0){
				this.lastChange = time;
			}
			if(time - this.lastChange > this.delay){
				this.imageIndex = (this.imageIndex + 1) % this.images.length;
				this.image = this.images[this.imageIndex];
				this.lastChange = time;
			}
		}
		RadarScoreComponent = Object.create(GameComponent);
		RadarScoreComponent.update = function(time, parent){
			if(parent.radarSize < 200){
				context.save();
				context.fillStyle = "#ff0000";
				context.font = "20px sans-serif";
				context.shadowBlur = 10;
				context.shadowColor = "#fff";
				context.fillText((parent.radarSize/32).toFixed(0), parent.x - 10, parent.y + 30);
				context.restore();
			}
		}
	}

	function makeAnimatedRadarRenderComponent(size){
		var c = Object.create(AnimatedRadarRenderComponent);
		c.size = 0;
		c.speed = 0.25; // Hz
		c.maxSize = 200;
		c.lastTime = 0;
		c.lastBrightness = 1;
		c.pinged = false;
		return c;
	}

	function makeSpriteComponent(image, width, height){
		var c = Object.create(SpriteComponent);
		c.image = image;
		c.iw = width;
		c.ih = height;
		return c;
	}

	function makeAnimatedSpriteComponent(images, width, height, cx, cy, speed){
		var c = Object.create(AnimatedSpriteComponent);
		c.image = images[0];
		c.images = images;
		c.cx = cx;
		c.cy = cy;
		c.iw = width;
		c.ih = height;
		c.delay = 1000 / speed;
		c.lastChange = 0;
		c.imageIndex = 0;
		return c;
	}

	function playSonarPing(){
		var source = audioContext.createBufferSource();
		source.buffer = sonarPing;
		source.connect(audioContext.destination);
		source.start(0);
	}

	function playTreasureSound(){
		var source = audioContext.createBufferSource();
		source.buffer = treasureSound;
		source.connect(audioContext.destination);
		source.start(0);
	}

	function playSound(buffer){
		var source = audioContext.createBufferSource();
		source.buffer = buffer;
		source.connect(audioContext.destination);
		source.start(0);
	}

	function distanceBetween(a, b){
		return Math.sqrt(Math.pow(a.x-b.x,2)+Math.pow(a.y-b.y,2));
	}

	function calculateBuoyScore(buoy){
		var dist,
			minDist = canvasWidth,
			i = treasures.length - 1,
			l = treasures.length;
		for (; i >= 0; i--) {
			dist = distanceBetween(treasures[i],buoy);
			minDist = Math.min(minDist, dist);
		};
		buoy.radarSize = minDist;
		return minDist;
	}

	function bootstrapCanvas(){
		gameBoard = $('#game-board');
		canvasWidth = gameBoard.width();
		canvasHeight = canvasWidth * BOARD_RATIO;

		context = gameBoard[0].getContext('2d');

		gameBoard.height(canvasHeight);
		gameBoard[0].width = canvasWidth;
		gameBoard[0].height = canvasHeight;

		actualGridX = canvasWidth / Math.round(canvasWidth / gridSize);
		actualGridY = canvasHeight / Math.round(canvasHeight / gridSize);

		gameBoard.on("click", function(e){
			var dist,
				minDist = canvasWidth,
				i = treasures.length - 1,
				buoy;
			for (; i >= 0; i--) {
				dist = distanceBetween(treasures[i],{x:e.offsetX,y:e.offsetY});
				minDist = Math.min(minDist, dist);
				if(dist < 32){
					treasures[i].components.push(makeSpriteComponent(chestImage,32,32));
					treasures.remove(i);
					playTreasureSound();
					for (i = buoys.length - 1; i >= 0; i--){
						calculateBuoyScore(buoys[i]);
					}
					if(!treasures.length){
						alert("Congratulations! You found all the treasure. Your Score was " + buoys.length);
					}
					return;
				}
			};
			// if(buoys.length < 16){
				buoy = makeGameObject();
				buoy.x = e.offsetX;// - (e.offsetX % actualGridX);
				buoy.y = e.offsetY;// - (e.offsetY % actualGridY);
				calculateBuoyScore(buoy);
				buoy.components.push(makeAnimatedRadarRenderComponent());
				buoy.components.push(makeAnimatedSpriteComponent([buoyImage,buoyImageOff],48,48,37*(48/75),55*(48/75),1));
				buoy.components.push(RadarScoreComponent);
				gameObjectManager.objects.push(buoy);
				buoys.push(buoy);
			// }else {
			// 	alert("Game Over. You did not find all the treasure!");
			// }
		});

		window.AudioContext = window.AudioContext||window.webkitAudioContext;
		audioContext = new AudioContext();
	}

	function bootstrapResources(){
		buoyImage = new Image();
		buoyImage.src = "img/buoy.png";
		buoyImageOff = new Image();
		buoyImageOff.src = "img/buoyOff.png";
		chestImage = new Image();
		chestImage.src = "img/chest.gif";

		var bl = new BufferLoader(audioContext, ['audio/sonarPing.wav', 'audio/coin.mp3'], function(buffer){
			sonarPing = buffer[0];
			treasureSound = buffer[1];
		});
		bl.load();
	}

	function bootstrapGameGraph(){

		gameObjectManager = makeGameObjectManager();

		var i = 0,
			l = 5,
			o;
		for (i = l - 1; i >= 0; i--) {
			o = makeGameObject();
			o.x = Math.random() * canvasWidth;
			o.y = Math.random() * canvasHeight;
			gameObjectManager.objects.push(o);
			treasures.push(o);
		};
	}

	function gameLoop(time){
		// clear board
		gameBoard[0].width = canvasWidth;
		context.save();
		context.fillStyle = "#105D82";
		context.fillRect(0,0,canvasWidth,canvasHeight);
		context.restore();

		gameObjectManager.update(time);

		renderThread();

		if(gameState == RUNNING){
			requestAnimationFrame(gameLoop);
		}
	}

	function renderThread(){
	}
});
}(jQuery,window));