import { Color3, HighlightLayer, Scene } from "@babylonjs/core";
import { BOAT_PARTS, TrainingDinghy, type BoatPart } from "../world/TrainingDinghy";

export class BoatLesson {
  private root = document.createElement("section");
  private text = document.createElement("p");
  private buttons = document.createElement("div");
  private highlighter: HighlightLayer;
  private onClose: (() => void) | null = null;
  public get isOpen(): boolean { return !this.root.hidden; }
  constructor(scene: Scene, private boat: TrainingDinghy, private readonly startRace: () => void) {
    this.highlighter = new HighlightLayer("boat-lesson-highlight", scene);
    this.root.className="npc-chat boat-lesson";
    this.root.hidden=true;
    this.root.setAttribute("role","dialog");
    this.root.setAttribute("aria-label","Устройство учебной яхты");
    const header=document.createElement("header");
    const title=document.createElement("h2"); title.textContent="Знакомство с яхтой";
    const close=document.createElement("button"); close.type="button"; close.textContent="Закончить ×"; close.addEventListener("click",()=>this.close());
    header.append(title,close);
    const intro=document.createElement("p"); intro.textContent="Капитан Морозов: выбери часть лодки, и я расскажу, зачем она нужна. Гик, руль и шверт можно привести в движение повторным нажатием.";
    this.buttons.className="boat-parts";
    for(const part of BOAT_PARTS) {
      const button=document.createElement("button"); button.type="button"; button.textContent=part.title; button.dataset.part=part.id;
      button.addEventListener("click",()=>this.select(part.id)); this.buttons.append(button);
    }
    this.text.className="boat-part-explanation"; this.text.setAttribute("aria-live","polite");
    const raceButton = document.createElement("button");
    raceButton.type = "button"; raceButton.className = "dialogue-button-primary";
    raceButton.textContent = "Выйти на тренировочную трассу";
    raceButton.addEventListener("click", () => { this.close(); this.startRace(); });
    this.root.append(header,intro,this.buttons,this.text,raceButton);
    this.root.addEventListener("keydown",(event)=>{event.stopPropagation(); if(event.key==="Escape") this.close();});
    this.root.addEventListener("keyup",(event)=>event.stopPropagation());
    document.body.append(this.root);
  }
  public open(onClose: () => void): void { this.onClose=onClose; this.root.hidden=false; this.select("hull"); this.root.querySelector<HTMLButtonElement>("button")?.focus(); }
  public close(): void { if(this.root.hidden)return; this.root.hidden=true; this.highlighter.removeAllMeshes(); const cb=this.onClose; this.onClose=null; cb?.(); }
  public dispose(): void { this.close(); this.highlighter.dispose(); this.root.remove(); }
  private select(id: BoatPart): void {
    const part=BOAT_PARTS.find((item)=>item.id===id); if(!part)return;
    this.highlighter.removeAllMeshes();
    for(const mesh of this.boat.parts.get(id) ?? []) this.highlighter.addMesh(mesh,Color3.FromHexString("#ffd070"));
    this.buttons.querySelectorAll("button").forEach((button)=>button.setAttribute("aria-pressed",String(button.dataset.part===id)));
    this.text.textContent=part.text; this.boat.select(id);
  }
}
