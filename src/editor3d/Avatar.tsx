import { useLayoutEffect, useMemo, useRef } from 'react';
import { BufferAttribute } from 'three';
import type { BufferGeometry, Mesh } from 'three';

import type { BodyMeasurements } from '@domain/measurements/types';
import { buildAvatar } from '@domain/avatar/body';
import type { Avatar as AvatarModel } from '@domain/avatar/types';

interface AvatarProps {
  readonly measurements: BodyMeasurements;
  readonly showLevels: boolean;
}

/**
 * Maniquí paramétrico.
 *
 * La malla se RECONSTRUYE al cambiar las medidas. No hay morph targets ni
 * interpolación entre formas: el cuerpo es una función de las medidas, igual
 * que el patrón. Cada sección se resuelve para tener exactamente el perímetro
 * medido, de modo que una cinta métrica alrededor de la cintura del maniquí
 * daría la cintura introducida.
 *
 * Construirlo cuesta unos milisegundos, así que se memoriza por medidas y se
 * escriben los buffers directamente en la geometría en lugar de recrearla.
 */
export function Avatar({ measurements, showLevels }: AvatarProps) {
  const avatar = useMemo(() => buildAvatar(measurements), [measurements]);

  return (
    <group>
      <BodyMesh avatar={avatar} />
      {showLevels && <MeasurementLevels avatar={avatar} />}
    </group>
  );
}

function BodyMesh({ avatar }: { avatar: AvatarModel }) {
  const geometry = useRef<BufferGeometry>(null);
  const mesh = useRef<Mesh>(null);

  /*
   * `useLayoutEffect` y no `useEffect`: los atributos deben estar escritos antes
   * de que el renderizador dibuje el primer fotograma, o se vería un destello
   * con la geometría vacía.
   */
  useLayoutEffect(() => {
    const target = geometry.current;
    if (target === null) return;

    target.setAttribute('position', new BufferAttribute(avatar.mesh.positions, 3));
    target.setAttribute('normal', new BufferAttribute(avatar.mesh.normals, 3));
    target.setIndex(new BufferAttribute(avatar.mesh.indices, 1));
    target.computeBoundingSphere();
  }, [avatar]);

  return (
    <mesh ref={mesh} castShadow receiveShadow>
      <bufferGeometry ref={geometry} />
      <meshStandardMaterial color="#d9cfc4" roughness={0.85} metalness={0.02} flatShading={false} />
    </mesh>
  );
}

/**
 * Anillos en las secciones medidas.
 *
 * Hacen visible la correspondencia entre número y cuerpo: al cambiar el
 * contorno de cintura, el anillo de la cintura cambia de tamaño ahí mismo. Sin
 * ellos el avatar sería un objeto bonito del que habría que fiarse.
 */
function MeasurementLevels({ avatar }: { avatar: AvatarModel }) {
  const rings = useMemo(() => {
    const found: { name: string; y: number }[] = [];

    for (const name of ['bust', 'waist', 'hip'] as const) {
      const y = avatar.levels[name];
      if (y !== undefined) found.push({ name, y });
    }

    return found;
  }, [avatar]);

  return (
    <group>
      {rings.map((entry) => (
        <mesh key={entry.name} position={[0, entry.y, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[avatar.heightMm * 0.19, 3, 8, 64]} />
          <meshBasicMaterial color="#4c9aff" transparent opacity={0.35} />
        </mesh>
      ))}
    </group>
  );
}
