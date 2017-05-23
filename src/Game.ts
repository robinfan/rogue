window.onload = () => {
    // Load art, start game
    PIXI.loader
        .add('core/art/sprites.json')
        .load(() => { let game = new Game(); })
}

class Game {
    // Rendering
    renderer: PIXI.CanvasRenderer | PIXI.WebGLRenderer;
    stage: PIXI.Container;
    floorContainer: PIXI.Container;
    blockContainer: PIXI.Container;
    itemContainer: PIXI.Container;
    lifeContainer: PIXI.Container;
    private worldContainers() : PIXI.Container[] { return [ this.floorContainer, this.blockContainer, this.itemContainer, this.lifeContainer ]; }
    minimapContainer: PIXI.Container;
    hudContainer: PIXI.Container;
    atlas: PIXI.loaders.TextureDictionary;

    readonly worldSpriteSize: number = 16; // (16x16)
    readonly worldTileDisplayWidth: number = 50; // Matches to canvas size (800)
    readonly worldTileDisplayHeight: number = 50; // Matches to canvas size (800)

    // HUD / Minimap
    hud: Hud
    minimap: Minimap;

    // Game
    floorLayer: CellLayer;
    blockLayer: CellLayer;
    itemLayer: CellLayer;
    lifeLayer: CellLayer;
    private worldLayers() : CellLayer[] { return [ this.floorLayer, this.blockLayer, this.itemLayer, this.lifeLayer ] }
    pfCollisionLayer: CellLayer; // For pathfinding only
    hero: Actor;
    playerTurn: boolean = true;

    constructor() {
        // Setup
        this.setupRenderer();
        this.setupEvents();

        // UI
        this.hud = new Hud();
        this.hudContainer.addChild(this.hud.combatHud)
        this.hudContainer.addChild(this.hud.infoHud)
        this.minimap = new Minimap();
        this.minimapContainer.addChild(this.minimap.graphics);

        // Generate & load a test map
        let map = MapGenerator.generateTestMap();
        this.loadMap(map);

        // Set camera/lighting/hud/etc (these tasks occur after each turn)
        this.turnEnded();

        // Start the game
        this.gameLoop();
    }

    private loadMap(map: Map) : void {
        // Setup layers
        this.pfCollisionLayer = new CellLayer(map.width, map.height);
        this.itemLayer = new CellLayer(map.width, map.height);
        this.floorLayer = new CellLayer(map.width, map.height);
        this.blockLayer = new CellLayer(map.width, map.height);
        this.lifeLayer = new CellLayer(map.width, map.height);

        // One-time setup
        for (let a of map.actors) {
            // Assign hero for easier reference
            if (a.actorType == ActorType.Hero) {
                this.hero = a;
            }

            // Setup their sprites
            let texture = this.getSpriteTexture(a.name);
            a.sprite = new PIXI.Sprite(texture);

            // Add to world
            this.addActorToWorld(a);
        }
    }

    // TODO: Define elsewhere
    private getSpriteTexture(actorName: string) : PIXI.Texture {
        let file = '';
        if (actorName == 'Hero') file = 'sprite350';
        else if (actorName == 'Floor') file = 'sprite210'
        else if (actorName == 'Wall') file = 'sprite172'
        else if (actorName == 'Gold') file = 'sprite250'
        else if (actorName == 'Monster') file = 'sprite378'
        else if (actorName == 'Torch') file = 'sprite247'
        else if (actorName == 'Chest') file = 'sprite244'
        else alert('getSpriteTexture: Unknown actor name -> sprite file: ' + actorName);
        return this.atlas[file];
    }

    private setupRenderer() : void {
        let canvas = <HTMLCanvasElement> document.getElementById("gameCanvas");
        this.renderer = PIXI.autoDetectRenderer(800, 800, { backgroundColor: CanvasColor.Background, view: canvas });
        this.stage = new PIXI.Container();
        this.floorContainer = new PIXI.Container();
        this.blockContainer = new PIXI.Container();
        this.itemContainer = new PIXI.Container();
        this.lifeContainer = new PIXI.Container();
        this.minimapContainer = new PIXI.Container();
        this.hudContainer = new PIXI.Container();

        this.stage.addChild(this.floorContainer);
        this.stage.addChild(this.blockContainer);
        this.stage.addChild(this.itemContainer);
        this.stage.addChild(this.lifeContainer);
        this.stage.addChild(this.minimapContainer);
        this.stage.addChild(this.hudContainer);

        this.atlas = PIXI.loader.resources['core/art/sprites.json'].textures;
    }

    private setupEvents() : void {
        window.addEventListener('keydown', (event: KeyboardEvent) => {
            // console.log(event.keyCode);
            // console.log(event.key);
            this.hud.lastKeyPressed = event.key + ' (' + event.keyCode + ')';

            if (this.playerTurn) {
                if (event.keyCode == KeyCode.w) {
                    this.doHeroWait();
                }

                let movement: Point;
                if (event.keyCode == KeyCode.UpArrow || event.keyCode == KeyCode.NumPad8) {
                    movement = new Point(0, -1);
                }
                else if (event.keyCode == KeyCode.DownArrow || event.keyCode == KeyCode.NumPad2) {
                    movement = new Point(0, 1);
                }
                else if (event.keyCode == KeyCode.LeftArrow || event.keyCode == KeyCode.NumPad4) {
                    movement = new Point(-1, 0);
                }
                else if (event.keyCode == KeyCode.RightArrow || event.keyCode == KeyCode.NumPad6) {
                    movement = new Point(1, 0);
                }

                if (movement != null) {
                    this.doHeroMovement(movement);

                    event.preventDefault(); // stop browser scrolling
                }
            }
        });
    }

    private doHeroWait() : void {
        this.hud.combatLog.push('You waited.');
        this.playerTurn = false;
        this.turnEnded();
        this.doNpcActions();
    }

    private doHeroMovement(movement: Point) : void {
        let destination = Point.Add(this.hero.position, movement);
        let blocker = this.blockLayer.actorAt(destination.x, destination.y);
        let a = this.lifeLayer.actorAt(destination.x, destination.y);
        let item = this.itemLayer.actorAt(destination.x, destination.y);

        let allowMove: boolean = true;
        if (blocker) {
            if (blocker.actorType == ActorType.Wall) {
                this.hud.combatLog.push('You cannot move there.');
            }
            else if (blocker.actorType == ActorType.Chest && !blocker.chestOpen) {
                let item = blocker.openChest();
                this.hero.inventory.addItem(item);
                this.hud.combatLog.push('You opened a chest...  found ' + item.name + '!');
            }

            allowMove = false;
        }
        else if (a) {
            if (a.actorType == ActorType.Npc) {
                // Atack it!
                a.inflictDamage(this.hero.damage);
                this.hud.combatLog.push('You attacked ' + a.name + ' for ' + this.hero.damage + ' damage.');

                if (a.isDead()) {
                    this.hud.combatLog.push('You killed ' + a.name + '!');
                    this.removeActorFromWorld(a);
                }

                allowMove = false;
            }
        }
        else if (item) {
            // For now, assume it's gold
            // Pick it up / give gold
            this.hero.inventory.gold += item.gold;

            this.hud.combatLog.push('You picked up ' + item.gold + ' gold!');
            this.removeActorFromWorld(item);
        }

        if (allowMove) {
            this.updateActorPosition(this.hero, destination);
        }

        this.playerTurn = false;
        this.turnEnded();
        this.doNpcActions();
    }

    private doNpcActions() : void {
        for (let a of this.lifeLayer.getActors()) {
            if (a.actorType == ActorType.Npc) {
                this.doNpcAction(a);
            }
        }

        this.playerTurn = true;
        this.turnEnded();
    }

    private doNpcAction(npc: Actor) {
        // TODO: Attempt to move towards player
        // This is insanely stupid.
        let destination = SimplePathfinder.GetClosestCellBetweenPoints(npc.position, this.hero.position);
        let blocker = this.blockLayer.actorAt(destination.x, destination.y);
        let a = this.lifeLayer.actorAt(destination.x, destination.y);

        let allowMove: boolean = true;
        if (blocker) {
            allowMove = false;
        }
        else if (a) {
            if (a.actorType == ActorType.Hero) {
                // Attack player
                a.inflictDamage(npc.damage);
                this.hud.combatLog.push(npc.name + ' attacked you for for ' + npc.damage + ' damage.');

                if (a.isDead()) {
                    this.hud.combatLog.push(npc.name + ' killed you!');
                    this.removeActorFromWorld(a);

                    // TODO: Hero needs to die.
                }

                allowMove = false;
            }
        }

        if (allowMove) {
            this.updateActorPosition(npc, destination);
        }
    }

    private turnEnded() : void {
        this.centerCameraOnHero();
        this.applyLightSources();
        this.hud.updateHudText(this.hero, this.playerTurn, this.pfCollisionLayer, this.floorLayer, this.blockLayer, this.lifeLayer, this.itemLayer);
        this.minimap.updateMinimap(this.floorLayer, this.blockLayer, this.lifeLayer, this.itemLayer);
    }

    private addActorToWorld(a: Actor) : void {
        let initPosition = a.position;

        // Add to appropriate layer
        let layer = this.getCellLayerForActor(a);
        layer.addActor(a, initPosition.x, initPosition.y);

        // Add to collision layer if appropriate
        if (a.blocksMovement) {
            this.pfCollisionLayer.addActor(a, initPosition.x, initPosition.y);
        }

        // Add their sprite
        let container = this.getContainerForActor(a);
        container.addChild(a.sprite);

        // Update the sprite's render position
        this.updateSpriteRenderPosition(a)
    }

    private updateActorPosition(a: Actor, newPosition: Point) : void {
        // Update the actor map position
        let layer = this.getCellLayerForActor(a);
        layer.moveActor(a, newPosition.x, newPosition.y);

        // Add to collision layer if appropriate
        if (a.blocksMovement) {
            this.pfCollisionLayer.moveActor(a, newPosition.x, newPosition.y);
        }

        // Update the hero's grid location
        a.position = newPosition;

        // Update the sprite's render position
        this.updateSpriteRenderPosition(a)
    }

    private removeActorFromWorld(a: Actor) : void {
        // Remove from actor layer
        let layer = this.getCellLayerForActor(a);
        layer.removeActor(a, a.position.x, a.position.y);

        // Remove from collision layer if appropriate
        if (a.blocksMovement) {
            this.pfCollisionLayer.removeActor(a, a.position.x, a.position.y);
        }

        // Remove their sprite
        let container = this.getContainerForActor(a);
        container.removeChild(a.sprite);
    }

    // TODO: Define elsewhere. Combine the cell layer / container gets. Potentially have them as properties on actor.
    private getCellLayerForActor(a: Actor) : CellLayer {
        let layer: CellLayer = null;
        if (a.actorType == ActorType.Hero || a.actorType == ActorType.Npc)
            layer = this.lifeLayer;
        else if (a.actorType == ActorType.Floor)
            layer = this.floorLayer;
        else if (a.actorType == ActorType.Wall || a.actorType == ActorType.Chest)
            layer = this.blockLayer;
        else if (a.actorType == ActorType.Item)
            layer = this.itemLayer;
        else
            alert('addActorToWorld: could not find a cellLayer for actor type: ' + a.actorType);
        return layer;
    }

    // TODO: Define elsewhere. Combine the cell layer / container gets. Potentially have them as properties on actor.
    private getContainerForActor(a: Actor) : PIXI.Container {
        let container: PIXI.Container = null;
        if (a.actorType == ActorType.Hero || a.actorType == ActorType.Npc)
            container = this.lifeContainer;
        else if (a.actorType == ActorType.Floor)
            container = this.floorContainer;
        else if (a.actorType == ActorType.Wall || a.actorType == ActorType.Chest)
            container = this.blockContainer;
        else if (a.actorType == ActorType.Item)
            container = this.itemContainer;
        else
            alert('addActorToWorld: could not find a container for actor type: ' + a.actorType);
        return container;
    }

    private updateSpriteRenderPosition(a: Actor) : void { // TODO: Will need refactor with camera/animation changes.
        let p = this.getSpriteRenderPosition(a);
        a.sprite.x = p.x;
        a.sprite.y = p.y;
    }

    private getSpriteRenderPosition(a: Actor) : Point {
        if (a.position == null) {
            var broken = true;
        }

        let rX = a.position.x * this.worldSpriteSize;
        let rY = a.position.y * this.worldSpriteSize;
        return new Point(rX, rY);
    }

    private getAllLayerActors() : Actor[] {
        let actors: Actor[] = [];
        for (let l of this.worldLayers()) {
            actors = actors.concat(l.getActors());
        }
        return actors;
    }

    private getAllLayerActorsAt(x: number, y: number) : Actor[] {
        let actors: Actor[] = [];
        for (let l of this.worldLayers()) {
            var a = l.actorAt(x, y);
            if (a != null) { // Don't add nulls
                actors.push(a);
            }
        }
        return actors;
    }

    private applyLightSources() : void {
        let allActors = this.getAllLayerActors();

        // Dim/shroud everything, then apply sources
        for (let a of allActors) {
            // Skip processing out-of-bounds actors
            if (!a.inRenderBounds)
                continue;

            // Set visible if they're not hidden under fog
            a.sprite.visible = !a.hiddenUnderFog;

            // Set appropriate tint (fog, shroud)
            a.sprite.tint = a.revealed ? LightSourceTint.Fog : LightSourceTint.Shroud;
        }

        // Dynamic lighting (origin to annulus)
        // Using a 3 cell annulus to make close vertical walls light up better (test with range 10). May want to scale with a formula instead.
        for (let a of allActors) {
            if (a.lightSourceRange <= 0) { // Actor doesn't provide any light.
                continue;
            }

            if (a.actorType != ActorType.Hero && !a.revealed && !a.lightSourceAlwaysVisible) { // Non-hero actor hasn't been revealed yet, and we don't want to always show it
                continue;
            }

            for (let annulusPoint of Geometry.pointsInAnnulus(a.position, a.lightSourceRange, 3)) {
                let line = Geometry.pointsInLine(a.position, annulusPoint);

                let obstructing = false;
                // Begin from light source origin
                for (let linePoint of line) {

                    if (obstructing)
                        break;

                    let distance = Point.Distance(a.position, linePoint);
                    let intensity = this.getLightSourceIntensity(distance, a.lightSourceRange);

                    for (let a2 of this.getAllLayerActorsAt(linePoint.x, linePoint.y)) {
                        if (a2.blocksLight) {
                            obstructing = true;
                        }

                        // We don't want to block the object itself from being lit, just ones after it.
                        if (a2.sprite.tint < intensity) { // If lit from multiple light sources, use the strongest light intensity ("blending")
                            a2.sprite.tint = intensity;
                        }
                        a2.sprite.visible = true;
                        a2.revealed = true;
                    }
                }
            }
        }
    }

    private getLightSourceIntensity(distance: number, maxDistance: number) : LightSourceTint {
        let i = distance / maxDistance

        if (i <= 0.75) return LightSourceTint.Visible1;
        if (i <= 0.80) return LightSourceTint.Visible2;
        if (i <= 0.85) return LightSourceTint.Visible3;
        if (i <= 0.90) return LightSourceTint.Visible4;
        if (i <= 0.95) return LightSourceTint.Visible5;
        else return LightSourceTint.Visible6;
    }

    private centerCameraOnHero() : void {
        // center on hero (not exactly center yet)
        let heroPos = this.getSpriteRenderPosition(this.hero);
        for (let c of this.worldContainers()) {
            c.x = (this.renderer.width / 2) - heroPos.x;
            c.y = (this.renderer.height / 2) - heroPos.y;
        }

        // don't render things outside of viewport
        let topLeft = heroPos.x - ((this.worldTileDisplayWidth / 2) * this.worldSpriteSize);
        let topRight = heroPos.x + ((this.worldTileDisplayWidth / 2) * this.worldSpriteSize);
        let bottomLeft = heroPos.y - ((this.worldTileDisplayHeight / 2) * this.worldSpriteSize);

        for (let a of this.getAllLayerActors()) {
            let pos = this.getSpriteRenderPosition(a);

            if (pos.x >= topLeft && pos.x <= topRight && pos.y >= bottomLeft) {
                a.inRenderBounds = true;
                a.sprite.visible = true;
            }
            else {
                a.inRenderBounds = false;
                a.sprite.visible = false;
            }
        }
    }

    private gameLoop = () => {
        requestAnimationFrame(this.gameLoop);
        this.renderer.render(this.stage);
    }
}