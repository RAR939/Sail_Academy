import { Game } from "./core/Game";
import "./styles/global.css";

const canvas = document.querySelector<HTMLCanvasElement>("#renderCanvas");

if (!canvas) {
  throw new Error("Canvas #renderCanvas не найден.");
}

const game = new Game(canvas);
game.start();

window.addEventListener("beforeunload", () => game.dispose());