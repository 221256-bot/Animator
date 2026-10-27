const SKIN = '#efc5a4';
const SHIRT = '#5b8def';
const PANTS = '#40516f';
const SHOE = '#252b38';
const INK = '#252b38';

export function createCharacter(id, x, y, name) {
  const part = (
    key,
    parentKey,
    shape,
    partX,
    partY,
    width,
    height,
    fill,
    rotation = 0,
  ) => ({
    id: `${id}_${key}`,
    parentId: parentKey ? `${id}_${parentKey}` : null,
    shape,
    x: partX,
    y: partY,
    shapeOffsetX: 0,
    shapeOffsetY: 0,
    width,
    height,
    rotation,
    fill,
    cornerRadius: shape === 'roundedRect' ? Math.min(width, height) / 2 : 0,
  });

  const character = {
    id,
    type: 'character',
    name,
    x,
    y,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    parts: [
      part('torso', null, 'roundedRect', 0, 0, 62, 88, SHIRT),
      part('head', 'torso', 'ellipse', 0, -44, 62, 70, SKIN),
      part('left-eye', 'head', 'ellipse', -12, -39, 6, 8, INK),
      part('right-eye', 'head', 'ellipse', 12, -39, 6, 8, INK),
      part('mouth', 'head', 'ellipse', 0, -22, 16, 4, '#b45d5b'),
      part('left-upper-arm', 'torso', 'roundedRect', -25, -30, 24, 50, SHIRT, -8),
      part('left-lower-arm', 'left-upper-arm', 'roundedRect', 0, 50, 19, 43, SKIN, -3),
      part('left-hand', 'left-lower-arm', 'ellipse', 0, 42, 22, 22, SKIN),
      part('right-upper-arm', 'torso', 'roundedRect', 25, -30, 24, 50, SHIRT, 8),
      part('right-lower-arm', 'right-upper-arm', 'roundedRect', 0, 50, 19, 43, SKIN, 3),
      part('right-hand', 'right-lower-arm', 'ellipse', 0, 42, 22, 22, SKIN),
      part('left-upper-leg', 'torso', 'roundedRect', -16, 40, 25, 48, PANTS),
      part('left-lower-leg', 'left-upper-leg', 'roundedRect', 0, 48, 21, 43, PANTS),
      part('left-foot', 'left-lower-leg', 'roundedRect', -4, 43, 38, 18, SHOE),
      part('right-upper-leg', 'torso', 'roundedRect', 16, 40, 25, 48, PANTS),
      part('right-lower-leg', 'right-upper-leg', 'roundedRect', 0, 48, 21, 43, PANTS),
      part('right-foot', 'right-lower-leg', 'roundedRect', 4, 43, 38, 18, SHOE),
    ],
  };

  const partByKey = new Map(
    character.parts.map((item) => [
      item.id.slice(id.length + 1),
      item,
    ]),
  );
  const shapeOffsets = {
    head: [0, -35],
    'left-upper-arm': [0, 24],
    'left-lower-arm': [0, 21.5],
    'left-hand': [0, 11],
    'right-upper-arm': [0, 24],
    'right-lower-arm': [0, 21.5],
    'right-hand': [0, 11],
    'left-upper-leg': [0, 24],
    'left-lower-leg': [0, 21.5],
    'left-foot': [0, 9],
    'right-upper-leg': [0, 24],
    'right-lower-leg': [0, 21.5],
    'right-foot': [0, 9],
  };
  for (const [key, [offsetX, offsetY]] of Object.entries(shapeOffsets)) {
    const item = partByKey.get(key);
    item.shapeOffsetX = offsetX;
    item.shapeOffsetY = offsetY;
  }

  return character;
}
