/** Entry point: boots the game once the DOM is ready. */
import { Game } from './game/game';
import { initKeyLabels } from './ui/keys';

function boot(): void {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const hud = document.getElementById('hud') as HTMLElement;
  const menus = document.getElementById('menus') as HTMLElement;
  void initKeyLabels();
  try {
    new Game(canvas, hud, menus);
  } catch (e) {
    console.error(e);
    document.body.insertAdjacentHTML(
      'beforeend',
      '<p style="position:fixed;inset:0;display:grid;place-items:center;color:#fff;font:16px system-ui;text-align:center;padding:2rem">' +
        'Impossible de démarrer le jeu : votre navigateur ne semble pas prendre en charge WebGL 2.</p>',
    );
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
