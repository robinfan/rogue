window.onload = () => {
    // Load art, start game
    PIXI.loader
        .add('core/art/sprites.json')
        .load(() => {
            // Important we put any static reusable bits here
            TextureAtlas.init();
            let game = new Game();
        });
}

class Game {
    // Rendering
    renderer: Renderer;

    // HUD / Minimap
    hud: Hud
    minimap: Minimap;
    characterUi: CharacterUi;

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
        this.renderer = new Renderer();

        // UI
        this.hud = new Hud();
        this.minimap = new Minimap();
        this.characterUi = new CharacterUi();

        this.renderer.addHud(this.hud);
        this.renderer.addMinimap(this.minimap);
        this.renderer.addCharacterUi(this.characterUi);

        // Bind key events
        this.setupEvents();

        // Generate & load a test map
        let map = MapGenerator.generateTestMap();
        this.loadMap(map);

        // Set camera/lighting/hud/etc (these tasks occur after each turn)
        this.turnEnded();
    }

    private setupEvents() : void {
        window.addEventListener('keydown', (event: KeyboardEvent) => {
            // console.log(event.keyCode);
            // console.log(event.key);
            this.hud.lastKeyPressed = event.key + ' (' + event.keyCode + ')';

            if (this.playerTurn) {
                if (event.keyCode == KeyCode.i) {
                    this.characterUi.toggle(this.hero); // TODO: Potential race condition where this is null
                }

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

            // Add to world
            this.addActorToWorld(a);
        }
    }

    private addActorToWorld(a: Actor) : void {
        // Add to appropriate layer
        let layer = this.getCellLayerForActor(a);
        layer.addActor(a, a.position.x, a.position.y);

        // Add to collision layer if appropriate
        if (a.blocksMovement) {
            this.pfCollisionLayer.addActor(a, a.position.x, a.position.y);
        }

        // Render (add)
        this.renderer.addActor(a);
    }

    private updateActorPosition(a: Actor, newPosition: Point) : void {
        // Update the actor map position
        let layer = this.getCellLayerForActor(a);
        layer.moveActor(a, newPosition.x, newPosition.y);

        // Update position in collision layer if appropriate
        if (a.blocksMovement) {
            this.pfCollisionLayer.moveActor(a, newPosition.x, newPosition.y);
        }

        // Update the hero's position
        a.position = newPosition;

        // Render (move)
        this.renderer.moveActor(a);
    }

    private removeActorFromWorld(a: Actor) : void {
        // Remove from actor layer
        let layer = this.getCellLayerForActor(a);
        layer.removeActor(a, a.position.x, a.position.y);

        // Remove from collision layer if appropriate
        if (a.blocksMovement) {
            this.pfCollisionLayer.removeActor(a, a.position.x, a.position.y);
        }

        // Render (remove)
        this.renderer.removeActor(a);
    }

    private getCellLayerForActor(a: Actor) : CellLayer {
        let layer: CellLayer = null;
        if (a.actorType == ActorType.Hero || a.actorType == ActorType.Npc)
            layer = this.lifeLayer;
        else if (a.actorType == ActorType.Floor)
            layer = this.floorLayer;
        else if (a.actorType == ActorType.Wall || a.actorType == ActorType.Chest || a.actorType == ActorType.Door)
            layer = this.blockLayer;
        else if (a.actorType == ActorType.Item)
            layer = this.itemLayer;
        else
            alert('addActorToWorld: could not find a cellLayer for actor type: ' + a.actorType);
        return layer;
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
            else if (blocker.actorType == ActorType.Door && !blocker.isDoorOpen) {
                blocker.openDoor();

                // Remove from collision layer
                this.pfCollisionLayer.removeActor(blocker, blocker.position.x, blocker.position.y);

                // Remove from blocker layer
                this.blockLayer.removeActor(blocker, blocker.position.x, blocker.position.y);

                this.hud.combatLog.push('You opened the door.');
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
        this.renderer.centerViewportOnHero(this.hero, this.getAllLayerActors());
        this.applyLightSources();
        this.hud.updateHudText(this.hero, this.playerTurn, this.pfCollisionLayer, this.floorLayer, this.blockLayer, this.lifeLayer, this.itemLayer);
        this.minimap.updateMinimap(this.floorLayer, this.blockLayer, this.lifeLayer, this.itemLayer);
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
            a.animation.sprite.visible = !a.hiddenUnderFog;

            // Set appropriate tint (fog, shroud)
            a.animation.sprite.tint = a.revealed ? LightSourceTint.Fog : LightSourceTint.Shroud;
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
                        if (a2.animation.sprite.tint < intensity) { // If lit from multiple light sources, use the strongest light intensity ("blending")
                            a2.animation.sprite.tint = intensity;
                        }
                        a2.animation.sprite.visible = true;
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
}