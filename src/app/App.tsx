import { Editor2D } from '@editor2d/Editor2D';
import { SidePanel } from '@editor2d/chrome/SidePanel';
import { StatusBar } from '@editor2d/chrome/StatusBar';
import { Toolbar } from '@editor2d/chrome/Toolbar';
import { Viewer3D } from '@editor3d/Viewer3D';

import { useViewer3DStore } from '@state/viewer3dStore';

import { useKeyboardShortcuts } from './useKeyboardShortcuts';

export function App() {
  useKeyboardShortcuts();

  const show3d = useViewer3DStore((state) => state.visible);

  return (
    <div className="app">
      <Toolbar />
      {/*
        El patrón y la prenda conviven en pantalla en vez de alternarse. Es la
        disposición que pide el objetivo final del proyecto —cambiar el patrón y
        ver el efecto en la prenda— y obliga desde ya a que la vista 3D no
        compita por la CPU con el editor.
      */}
      <main className={`app__main${show3d ? ' app__main--split' : ''}`}>
        <Editor2D />
        {show3d && <Viewer3D />}
        <SidePanel />
      </main>
      <StatusBar />
    </div>
  );
}
