import {
  ArcRotateCamera, Color3, Color4, DynamicTexture, Engine, HemisphericLight, Matrix, Mesh, MeshBuilder,
  Scalar, Scene, StandardMaterial, TransformNode, Vector3, VertexData,
} from "@babylonjs/core";
import { NetworkClient } from "../network/NetworkClient";
import type { BoatStateMessage, RaceStateMessage, RaceLobbyMessage } from "../network/NetworkMessages";
import { TrainingDinghy } from "../world/TrainingDinghy";
import { WaterSurface } from "../rendering/WaterSurface";

/** Shared server-authoritative race course. */
export class RaceScene {
  public readonly scene: Scene;
  private readonly camera: ArcRotateCamera;
  private readonly boat: TrainingDinghy;
  private readonly water: WaterSurface;
  private readonly anchor: TransformNode;
  private readonly hud = document.createElement("aside");
  private readonly status = document.createElement("p");
  private readonly telemetry = document.createElement("p");
  private readonly lobbyText = document.createElement("p");
  private readonly startButton = document.createElement("button");
  private lobby: RaceLobbyMessage | null = null;
  private readonly windArrow = document.createElement("span");
  private readonly windText = document.createElement("span");
  private readonly marks: Mesh[] = [];
  private readonly markLabels: Mesh[] = [];
  private readonly worldWindArrow: Mesh;
  private readonly startLine: Mesh;
  private readonly finishLine: Mesh;
  private readonly startMarker: TransformNode;
  private readonly finishMarker: TransformNode;
  private readonly committeeBoat: TransformNode;
  private signalFlag: Mesh | null = null;
  private laserFlag: Mesh | null = null;
  private signalTexture: DynamicTexture | null = null;
  private signalKey = "";
  private gateLine: Mesh | null = null;
  private gateKey = "";
  private readonly remote = new Map<number, { anchor: TransformNode; boat: TrainingDinghy; target: BoatStateMessage }>();
  private readonly unsubscribers: Array<() => void> = [];
  private readonly keys = new Set<string>();
  private heading = 0.8;
  private sailAngle = 0.5;
  private windSpeed = 5;
  private windDirection = 0;
  private serverBoat: BoatStateMessage | null = null;
  private progress: RaceStateMessage | null = null;
  private sendTime = 0;
  private disposed = false;

  constructor(engine: Engine, private readonly canvas: HTMLCanvasElement, private readonly network: NetworkClient, private readonly userId: number) {
    this.scene = new Scene(engine);
    this.scene.clearColor = new Color4(0.63, 0.83, 0.92, 1);
    const light = new HemisphericLight("race-sun", new Vector3(0.2,1,-0.3), this.scene); light.intensity = 1.1;
    const sea = MeshBuilder.CreateGround("race-sea", {width: 600, height: 600}, this.scene);
    const water = new StandardMaterial("race-water", this.scene); water.diffuseColor = Color3.FromHexString("#469fa8"); water.specularColor = new Color3(0.3,0.4,0.4); sea.material = water;
    this.water = new WaterSurface(this.scene, water, 40, 40);
    this.anchor = new TransformNode("race-local-boat", this.scene); this.anchor.position.set(-22,0,-18);
    this.boat = new TrainingDinghy(this.scene, this.anchor); this.boat.root.position.set(0,0,0); this.boat.root.rotation.y = Math.PI;
    this.camera = new ArcRotateCamera("race-camera", -Math.PI / 2, 0.9, 16, this.anchor.position, this.scene);
    this.camera.lowerRadiusLimit = 8; this.camera.upperRadiusLimit = 30; this.camera.attachControl(canvas, true);
    this.camera.lowerBetaLimit = 0.2;
    this.camera.upperBetaLimit = Math.PI / 2 - 0.08;
    this.scene.activeCamera = this.camera;
    // Arrow lives above the water upwind of the boat, points with the true wind.
    this.worldWindArrow = new Mesh("world-wind-arrow", this.scene);
    const arrowData = new VertexData();
    arrowData.positions = [-0.16,0,-2, 0.16,0,-2, -0.16,0,0.8, 0.16,0,0.8, -0.7,0,0.8, 0.7,0,0.8, 0,0,2];
    arrowData.indices = [0,1,2, 1,3,2, 4,5,6];
    const arrowNormals: number[] = [];
    VertexData.ComputeNormals(arrowData.positions, arrowData.indices, arrowNormals);
    arrowData.normals = arrowNormals; arrowData.applyToMesh(this.worldWindArrow);
    const arrowMaterial = new StandardMaterial("wind-arrow-material", this.scene);
    arrowMaterial.diffuseColor = Color3.FromHexString("#ffb83e");
    arrowMaterial.emissiveColor = Color3.FromHexString("#b65b00");
    arrowMaterial.disableLighting = true; arrowMaterial.backFaceCulling = false;
    this.worldWindArrow.material = arrowMaterial; this.worldWindArrow.isPickable = false;
    const lineMat = new StandardMaterial("start-line",this.scene); lineMat.diffuseColor=Color3.FromHexString("#f7e9ce"); lineMat.emissiveColor=Color3.FromHexString("#82724e");
    this.startLine = MeshBuilder.CreateBox("race-start",{width:1,height:0.06,depth:0.3},this.scene); this.startLine.material=lineMat;
    const finishMat = new StandardMaterial("finish-line-material",this.scene);
    finishMat.diffuseColor = Color3.FromHexString("#55c9d8"); finishMat.emissiveColor = Color3.FromHexString("#1c6370");
    this.finishLine = MeshBuilder.CreateBox("race-finish-line",{width:1,height:0.06,depth:0.3},this.scene); this.finishLine.material=finishMat;
    this.startMarker = this.createFlag("S", lineMat);
    this.finishMarker = this.createFlag("F", finishMat);
    this.committeeBoat = this.createCommitteeBoat();
    this.setCourseLines([[-45,0],[0,0]], [[0,0],[25,0]]);
    this.hud.className="shore-hud race-hud";
    const title=document.createElement("h2"); title.textContent="Гоночная комната";
    this.lobbyText.className = "race-lobby";
    this.lobbyText.textContent = "Подключаемся к комнате…";
    this.startButton.type = "button"; this.startButton.textContent = "Начать предстартовый отсчёт · 3 мин";
    this.startButton.hidden = true;
    this.startButton.addEventListener("click", () => { this.startButton.disabled = true; this.network.startRace(); });
    this.status.textContent="Старт: пересеките линию между S и судейской лодкой.";
    const controls=document.createElement("p"); controls.className="race-controls";
    controls.textContent="A / D или ← / → — румпель · Q — подобрать шкот · E — потравить шкот · мышь и колесо — камера. Стрелка над водой показывает, куда дует ветер. Огибайте каждый знак, оставляя его слева.";
    const windIndicator = document.createElement("div"); windIndicator.className = "race-wind-indicator";
    this.windArrow.className = "race-wind-arrow"; this.windArrow.textContent = "➜"; this.windArrow.setAttribute("aria-hidden", "true");
    this.windText.textContent = "ВЕТЕР ДУЕТ";
    windIndicator.append(this.windArrow, this.windText);
    const back=document.createElement("button"); back.type="button"; back.textContent="Вернуться на берег";
    back.addEventListener("click",()=>{
      if (!this.network.isConnected) { this.status.textContent = "Нет соединения с сервером."; return; }
      back.disabled = true;
      this.status.textContent = "Возвращаемся на берег…";
      try { this.network.enterLocation("club"); }
      catch { back.disabled = false; this.status.textContent = "Не удалось запросить возвращение на берег."; }
      window.setTimeout(() => { if (!this.disposed) back.disabled = false; }, 5000);
    });
    this.hud.append(title,this.lobbyText,this.startButton,this.status,windIndicator,this.telemetry,controls,back); document.body.append(this.hud);
    window.addEventListener("keydown",this.onDown); window.addEventListener("keyup",this.onUp); window.addEventListener("blur",this.onBlur);
    this.unsubscribers.push(
      network.on("players",(message)=>this.updatePlayers(message.delta)),
      network.on("wind",(message)=>{this.windSpeed=message.speed;this.windDirection=message.direction;}),
      network.on("race_state",(message)=>{this.progress=message;this.renderProgress();}),
      network.on("race_lobby",(message)=>{this.lobby=message;this.renderLobby();this.renderProgress();}),
      network.on("error",(message)=>{this.status.textContent=message.message;this.startButton.disabled=false;}),
    );
    canvas.focus();
  }

  public update(dt: number): void {
    const delta=Math.min(Math.max(dt,0),0.1);
    const turn=(this.keys.has("KeyD")||this.keys.has("ArrowRight")?1:0)-(this.keys.has("KeyA")||this.keys.has("ArrowLeft")?1:0);
    const sheet=(this.keys.has("KeyE")?1:0)-(this.keys.has("KeyQ")?1:0);
    this.heading += turn * 0.8 * delta;
    this.sailAngle = Math.max(0,Math.min(Math.PI/2,this.sailAngle + sheet * 0.8 * delta));
    this.sendTime += delta;
    if(this.sendTime>=0.1 && this.network.isConnected) { this.sendTime%=0.1; this.network.sendBoatInput(this.heading,this.sailAngle); }
    if(this.serverBoat) {
      const [x,y,z]=this.serverBoat.pos;
      const target=new Vector3(x,y,z);
      const smoothing = 1 - Math.exp(-10 * delta);
      this.anchor.position = Vector3.Lerp(this.anchor.position,target,smoothing);
      // Snapshot angles arrive at 15 Hz; interpolate via the shortest arc.
      this.anchor.rotation.y = Scalar.LerpAngle(this.anchor.rotation.y, this.serverBoat.heading, smoothing);
    }
    this.camera.target.copyFrom(this.anchor.position);
    const relative=Math.abs(Math.atan2(Math.sin(this.windDirection-(this.serverBoat?.heading ?? this.heading)),Math.cos(this.windDirection-(this.serverBoat?.heading ?? this.heading))));
    const speed=this.serverBoat?.speed ?? 0;
    this.boat.setSailingState(this.sailAngle, this.windDirection, this.anchor.rotation.y);
    this.boat.update(delta);
    this.water.update(delta);
    for (const remote of this.remote.values()) {
      const blend = 1 - Math.exp(-8 * delta);
      remote.anchor.position = Vector3.Lerp(remote.anchor.position, Vector3.FromArray(remote.target.pos), blend);
      remote.anchor.rotation.y = Scalar.LerpAngle(remote.anchor.rotation.y, remote.target.heading, blend);
      remote.boat.setSailingState(remote.target.sailAngle, this.windDirection, remote.anchor.rotation.y);
      remote.boat.update(delta);
    }
    this.worldWindArrow.position.set(
      this.anchor.position.x + Math.sin(this.windDirection) * 6,
      0.15,
      this.anchor.position.z + Math.cos(this.windDirection) * 6,
    );
    this.worldWindArrow.rotation.y = this.windDirection + Math.PI;
    // Display wind flow relative to the camera, so the arrow matches the view.
    const flow = new Vector3(-Math.sin(this.windDirection), 0, -Math.cos(this.windDirection));
    const viewport = this.camera.viewport.toGlobal(this.scene.getEngine().getRenderWidth(), this.scene.getEngine().getRenderHeight());
    const viewProjection = this.camera.getTransformationMatrix();
    const origin = this.anchor.position.add(new Vector3(0, 1, 0));
    const start = Vector3.Project(origin, Matrix.IdentityReadOnly, viewProjection, viewport);
    const end = Vector3.Project(origin.add(flow.scale(4)), Matrix.IdentityReadOnly, viewProjection, viewport);
    const screenX = end.x - start.x;
    const screenY = end.y - start.y;
    this.windArrow.style.transform = `rotate(${Math.atan2(screenY, screenX)}rad)`;
    this.windText.textContent = `ВЕТЕР ДУЕТ · ${this.windSpeed.toFixed(1)} м/с`;
    this.telemetry.textContent=`Скорость: ${speed.toFixed(1)} м/с · Ветер: ${this.windSpeed.toFixed(1)} м/с · Угол к ветру: ${Math.round(relative*180/Math.PI)}° · Шкот: ${Math.round(this.sailAngle*180/Math.PI)}°${relative<Math.PI*25/180?' · СЛИШКОМ КРУТО К ВЕТРУ':''}`;
    this.scene.render();
  }

  private createFlag(text: string, material: StandardMaterial): TransformNode {
    const root = new TransformNode(`course-${text}`, this.scene);
    const buoy = MeshBuilder.CreateSphere(`course-${text}-buoy`, {diameter: 1.4, segments: 10}, this.scene);
    buoy.parent = root; buoy.position.y = 0.7; buoy.material = material;
    const pole = MeshBuilder.CreateCylinder(`course-${text}-pole`, {height: 3, diameter: 0.09}, this.scene);
    pole.parent = root; pole.position.y = 2; pole.material = material;
    const flag = MeshBuilder.CreateBox(`course-${text}-flag`, {width: 0.9, height: 0.6, depth: 0.04}, this.scene);
    flag.parent = root; flag.position.set(0.46, 3.2, 0); flag.material = material;
    const texture = new DynamicTexture(`course-${text}-texture`, {width:128,height:128}, this.scene, false);
    texture.drawText(text, null, 95, "bold 94px Arial", "#ffffff", "transparent", true); texture.hasAlpha = true;
    const labelMat = new StandardMaterial(`course-${text}-label-mat`, this.scene);
    labelMat.diffuseTexture = texture; labelMat.useAlphaFromDiffuseTexture = true;
    labelMat.emissiveColor = Color3.White(); labelMat.disableLighting = true; labelMat.backFaceCulling = false;
    const label = MeshBuilder.CreatePlane(`course-${text}-label`, {size: 2}, this.scene);
    label.parent = root; label.position.y = 4.5; label.billboardMode = Mesh.BILLBOARDMODE_ALL;
    label.material = labelMat; label.isPickable = false;
    return root;
  }

  private createCommitteeBoat(): TransformNode {
    const root = new TransformNode("committee-boat", this.scene);
    const white = new StandardMaterial("committee-hull-material", this.scene);
    white.diffuseColor = Color3.FromHexString("#f1eee2");
    const blue = new StandardMaterial("committee-cabin-material", this.scene);
    blue.diffuseColor = Color3.FromHexString("#345b71");
    const hull = MeshBuilder.CreateBox("committee-hull", {width:2.2,height:0.6,depth:4.8}, this.scene);
    hull.parent = root; hull.position.y = 0.5; hull.material = white;
    const cabin = MeshBuilder.CreateBox("committee-cabin", {width:1.4,height:1.1,depth:1.5}, this.scene);
    cabin.parent = root; cabin.position.set(0,1.35,0.2); cabin.material = blue;
    const roof = MeshBuilder.CreateBox("committee-roof", {width:1.7,height:0.12,depth:1.8}, this.scene);
    roof.parent = root; roof.position.set(0,1.96,0.2); roof.material = white;
    const mast = MeshBuilder.CreateCylinder("signal-mast", {height:4, diameter:.08}, this.scene);
    mast.parent = root; mast.position.set(0,3.9,0); mast.material = white;
    this.signalTexture = new DynamicTexture("race-signal-texture", {width:256,height:160}, this.scene, false);
    const flagMaterial = new StandardMaterial("race-signal-material", this.scene);
    flagMaterial.diffuseTexture = this.signalTexture; flagMaterial.emissiveColor = Color3.White(); flagMaterial.disableLighting = true; flagMaterial.backFaceCulling = false;
    this.signalFlag = MeshBuilder.CreatePlane("race-signal-flag", {width:2,height:1.25}, this.scene);
    this.signalFlag.parent = root; this.signalFlag.position.set(1,5.1,0); this.signalFlag.material = flagMaterial; this.signalFlag.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.signalFlag.setEnabled(false);
    const laserTexture = new DynamicTexture("laser-class-flag", {width:256,height:160}, this.scene, false);
    const laserContext = laserTexture.getContext() as CanvasRenderingContext2D;
    laserContext.fillStyle = "#ffffff"; laserContext.fillRect(0,0,256,160);
    laserContext.strokeStyle = "#d92925"; laserContext.lineWidth = 11; laserContext.lineCap = "round";
    for (let i = -2; i <= 2; i++) { const angle = i * Math.PI / 4; laserContext.beginPath(); laserContext.moveTo(128 + 18*Math.sin(angle),70 - 18*Math.cos(angle)); laserContext.lineTo(128 + 48*Math.sin(angle),70 - 48*Math.cos(angle)); laserContext.stroke(); }
    laserContext.fillStyle = "#d92925"; laserContext.font = "bold 27px Arial"; laserContext.textAlign = "center"; laserContext.fillText("LASER",128,143); laserTexture.update();
    const laserMaterial = new StandardMaterial("laser-class-flag-material", this.scene);
    laserMaterial.diffuseTexture = laserTexture; laserMaterial.emissiveColor = Color3.White(); laserMaterial.disableLighting = true; laserMaterial.backFaceCulling = false;
    this.laserFlag = MeshBuilder.CreatePlane("laser-class-flag", {width:2,height:1.25}, this.scene);
    this.laserFlag.parent = root; this.laserFlag.position.set(1,6.45,0); this.laserFlag.material = laserMaterial; this.laserFlag.billboardMode = Mesh.BILLBOARDMODE_ALL; this.laserFlag.setEnabled(false);
    return root;
  }

  private setCourseLines(start: [[number,number],[number,number]], finish: [[number,number],[number,number]]): void {
    const set = (mesh: Mesh, points: [[number,number],[number,number]]) => {
      const [a,b] = points; const dx=b[0]-a[0], dz=b[1]-a[1];
      mesh.position.set((a[0]+b[0])/2, 0.04, (a[1]+b[1])/2);
      mesh.scaling.x = Math.hypot(dx,dz); mesh.rotation.y = Math.atan2(-dz,dx);
    };
    set(this.startLine, start); set(this.finishLine, finish);
    this.startMarker.position.set(start[0][0],0,start[0][1]);
    this.finishMarker.position.set(finish[1][0],0,finish[1][1]);
    this.committeeBoat.position.set(start[1][0],0,start[1][1]);
  }

  private updatePlayers(players: {id:number;boat?:BoatStateMessage}[]): void {
    const present=new Set<number>();
    for(const state of players) {
      if(!state.boat) continue;
      if(state.id===this.userId) { this.serverBoat=state.boat; continue; }
      present.add(state.id);
      let remote=this.remote.get(state.id);
      if(!remote) {
        const anchor = new TransformNode(`remote-boat-${state.id}`, this.scene);
        const boat = new TrainingDinghy(this.scene, anchor); boat.root.position.set(0,0,0); boat.root.rotation.y = Math.PI;
        anchor.position.set(...state.boat.pos); anchor.rotation.y = state.boat.heading;
        remote = { anchor, boat, target: state.boat }; this.remote.set(state.id, remote);
      }
      remote.target = state.boat;
    }
    for(const [id,remote] of this.remote) if(!present.has(id)) {remote.boat.dispose();remote.anchor.dispose();this.remote.delete(id);}
  }
  private renderLobby(): void {
    const lobby = this.lobby; if (!lobby) return;
    const signal = lobby.phase === "countdown" && (lobby.secondsLeft ?? 0) <= 120 && (lobby.secondsLeft ?? 0) > 60 ? "prepare" : lobby.phase === "racing" && lobby.players.some(player => player.individualRecall) ? "recall" : "none";
    this.laserFlag?.setEnabled(lobby.phase === "countdown");
    if (signal !== this.signalKey && this.signalTexture && this.signalFlag) {
      this.signalKey = signal; this.signalFlag.setEnabled(signal !== "none");
      const ctx = this.signalTexture.getContext() as CanvasRenderingContext2D;
      ctx.fillStyle = signal === "prepare" ? "#1b4eaa" : "#ffffff"; ctx.fillRect(0, 0, 256, 160);
      ctx.fillStyle = signal === "prepare" ? "#ffffff" : "#1653a7";
      if (signal === "prepare") ctx.fillRect(64, 40, 128, 80);
      else { ctx.fillRect(0, 66, 256, 28); ctx.fillRect(114, 0, 28, 160); }
      this.signalTexture.update();
    }
    const remaining = Math.ceil(lobby.secondsLeft ?? 0);
    const countdown = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
    const header = lobby.phase === "waiting" ? "Ожидание участников" : lobby.phase === "countdown" ? `До старта ${countdown}` : "Старт дан";
    const standings = lobby.players.map((player, index) => {
      const result = player.elapsed === null ? (player.individualRecall ? "индивидуальный отзыв" : player.phase === "start" ? "перед стартом" : "на дистанции") : `финиш ${player.elapsed.toFixed(1)} с`;
      return `${index + 1}. ${player.name}${player.id === lobby.hostId ? " ★" : ""} — ${result}`;
    });
    const signalText = lobby.phase === "countdown" ? `Флаг Laser${signal === "prepare" ? " · флаг P" : ""}` : signal === "recall" ? "Флаг X: индивидуальный отзыв" : "";
    this.startButton.textContent = `Начать отсчёт · ${lobby.countdownSeconds} с`;
    this.lobbyText.textContent = `Комната: ${lobby.roomId}\n${header} · ${lobby.players.length}/${lobby.maxPlayers}\n${signalText}\n${standings.join("\n")}`;
    this.startButton.hidden = lobby.phase !== "waiting" || lobby.hostId !== this.userId;
    if (!this.startButton.hidden) this.startButton.disabled = false;
  }
  private renderProgress(): void {
    const state=this.progress;if(!state)return;
    this.setCourseLines(state.startLine, state.finishLine);
    for (let i = this.marks.length; i < state.marks.length; i++) {
      const mark = MeshBuilder.CreateCylinder(`race-mark-${i}`, {height:2.2, diameterTop:0.7, diameterBottom:1.8, tessellation:12}, this.scene);
      const material = new StandardMaterial(`race-mark-material-${i}`,this.scene);
      material.diffuseColor = Color3.FromHexString("#ed893e"); mark.material=material; this.marks.push(mark);
      const texture = new DynamicTexture(`race-mark-label-${i}`, {width:128,height:128}, this.scene, false);
      texture.drawText(String(i+1), null, 95, "bold 94px Arial", "#ffffff", "transparent", true);
      texture.hasAlpha = true;
      const labelMaterial = new StandardMaterial(`race-mark-label-material-${i}`, this.scene);
      labelMaterial.diffuseTexture = texture; labelMaterial.useAlphaFromDiffuseTexture = true;
      labelMaterial.emissiveColor = Color3.White(); labelMaterial.disableLighting = true;
      labelMaterial.backFaceCulling = false;
      const label = MeshBuilder.CreatePlane(`race-mark-number-${i}`, {size:2}, this.scene);
      label.billboardMode = Mesh.BILLBOARDMODE_ALL; label.material = labelMaterial;
      label.isPickable = false; this.markLabels.push(label);
    }
    this.marks.forEach((mark, index) => {
      const point = state.marks[index];
      mark.setEnabled(!!point);
      const label = this.markLabels[index];
      label?.setEnabled(!!point);
      if (point) { mark.position.set(point[0],1.1,point[1]); label?.position.set(point[0],3.3,point[1]); }
    });
    const current = state.marks[state.nextMark];
    const gateKey = state.phase === "marks" && current && state.roundingGate
      ? `${state.nextMark}:${current.join(",")}:${state.roundingGate.join(",")}:${state.markRadius}` : "";
    if (gateKey !== this.gateKey) {
      this.gateLine?.dispose(); this.gateLine = null; this.gateKey = gateKey;
    }
    if (!this.gateLine && gateKey && current && state.roundingGate) {
      const [gx,gz] = state.roundingGate;
      this.gateLine = MeshBuilder.CreateLines("rounding-gate", {points:[
        new Vector3(current[0]+gx*1.3, 0.12, current[1]+gz*1.3),
        new Vector3(current[0]+gx*state.markRadius, 0.12, current[1]+gz*state.markRadius),
      ]}, this.scene);
      (this.gateLine as import("@babylonjs/core").LinesMesh).color = Color3.FromHexString("#f5dd80");
      this.gateLine.isPickable = false;
    }
    const labels={start:"Стартуйте между S и судейской лодкой в сторону знака 1.",marks:`Огибайте знак ${state.nextMark+1} из ${state.marks.length}, оставляя его слева.`,finish:"Финишируйте между судейской лодкой и F в сторону знака 1.",completed:`Финиш! Время: ${state.elapsed.toFixed(1)} с.`};
    this.status.textContent = this.lobby?.phase === "waiting"
      ? "Ожидайте участников и начала отсчёта."
      : this.lobby?.phase === "countdown"
        ? "Маневрируйте перед линией. К сигналу вернитесь на предстартовую сторону."
        : state.individualRecall
          ? "Индивидуальный отзыв! Вернитесь всем корпусом на предстартовую сторону и стартуйте заново."
          : `${labels[state.phase]} · ${state.elapsed.toFixed(1)} с`;
    this.marks.forEach((mesh,index)=>{ const mat=mesh.material as StandardMaterial; mat.emissiveColor=state.phase==="marks" && index===state.nextMark ? new Color3(0.65,0.35,0.05) : Color3.Black(); });
  }
  private readonly onDown=(event:KeyboardEvent):void=>{if(["KeyA","KeyD","ArrowLeft","ArrowRight","KeyQ","KeyE"].includes(event.code)){event.preventDefault();this.keys.add(event.code);}};
  private readonly onUp=(event:KeyboardEvent):void=>{this.keys.delete(event.code);};
  private readonly onBlur=():void=>{this.keys.clear();};
  public dispose():void {
    if(this.disposed)return;this.disposed=true;
    window.removeEventListener("keydown",this.onDown);window.removeEventListener("keyup",this.onUp);window.removeEventListener("blur",this.onBlur);
    this.unsubscribers.forEach(fn=>fn());this.hud.remove();this.boat.dispose();this.water.dispose();
    for (const remote of this.remote.values()) { remote.boat.dispose(); remote.anchor.dispose(); }
    this.scene.dispose();
  }
}
