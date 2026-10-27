const templates = new Map();

function component(id, type, x, y, fill, dimensions, parentId = null, rotation = 0) {
  return {
    id,
    type,
    parentId,
    x,
    y,
    rotation,
    fill,
    ...dimensions,
  };
}

export function registerObjectTemplate(template) {
  if (
    !template ||
    typeof template.id !== 'string' ||
    !/^[a-z][a-z0-9_-]*$/.test(template.id) ||
    typeof template.label !== 'string' ||
    typeof template.createComponents !== 'function'
  ) {
    throw new Error('Object templates require a valid id, label, and component factory.');
  }
  templates.set(template.id, template);
}

registerObjectTemplate({
  id: 'tree',
  label: 'Tree',
  createComponents: (id) => [
    component(`${id}_trunk`, 'rectangle', 0, 42, '#8a593d', {
      width: 28,
      height: 100,
    }),
    component(`${id}_canopy`, 'circle', 0, -70, '#3f9b62', {
      radius: 62,
    }, `${id}_trunk`),
    component(`${id}_canopy_left`, 'circle', -38, 30, '#50ad6f', {
      radius: 37,
    }, `${id}_canopy`),
    component(`${id}_canopy_right`, 'circle', 38, 30, '#50ad6f', {
      radius: 37,
    }, `${id}_canopy`),
  ],
});

registerObjectTemplate({
  id: 'cloud',
  label: 'Cloud',
  createComponents: (id) => [
    component(`${id}_puff_center`, 'circle', 0, 0, '#f7fbff', {
      radius: 34,
    }),
    component(`${id}_puff_left`, 'circle', -34, 10, '#f7fbff', {
      radius: 25,
    }),
    component(`${id}_puff_right`, 'circle', 34, 10, '#f7fbff', {
      radius: 25,
    }),
    component(`${id}_base`, 'rectangle', 0, 17, '#f7fbff', {
      width: 82,
      height: 24,
      cornerRadius: 12,
    }),
  ],
});

registerObjectTemplate({
  id: 'house',
  label: 'House',
  createComponents: (id) => [
    component(`${id}_walls`, 'rectangle', 0, 22, '#f0d2a2', {
      width: 150,
      height: 115,
    }),
    component(`${id}_roof_left`, 'rectangle', -38, -69, '#a64f46', {
      width: 100,
      height: 18,
    }, `${id}_walls`, -32),
    component(`${id}_roof_right`, 'rectangle', 38, -69, '#a64f46', {
      width: 100,
      height: 18,
    }, `${id}_walls`, 32),
    component(`${id}_door`, 'rectangle', 0, 35, '#76503d', {
      width: 34,
      height: 70,
    }, `${id}_walls`),
    component(`${id}_window_left`, 'rectangle', -47, -7, '#86c8df', {
      width: 30,
      height: 30,
    }, `${id}_walls`),
    component(`${id}_window_right`, 'rectangle', 47, -7, '#86c8df', {
      width: 30,
      height: 30,
    }, `${id}_walls`),
  ],
});

registerObjectTemplate({
  id: 'bench',
  label: 'Bench',
  createComponents: (id) => [
    component(`${id}_seat`, 'rectangle', 0, 0, '#a87546', {
      width: 135,
      height: 18,
      cornerRadius: 4,
    }),
    component(`${id}_back`, 'rectangle', 0, -28, '#b98752', {
      width: 135,
      height: 18,
      cornerRadius: 4,
    }),
    component(`${id}_leg_left`, 'rectangle', -47, 28, '#4d5259', {
      width: 10,
      height: 48,
    }),
    component(`${id}_leg_right`, 'rectangle', 47, 28, '#4d5259', {
      width: 10,
      height: 48,
    }),
  ],
});

registerObjectTemplate({
  id: 'table',
  label: 'Table',
  createComponents: (id) => [
    component(`${id}_top`, 'rectangle', 0, 0, '#a87546', {
      width: 150,
      height: 20,
      cornerRadius: 4,
    }),
    component(`${id}_leg_left`, 'rectangle', -55, 48, '#76503d', {
      width: 12,
      height: 82,
    }),
    component(`${id}_leg_right`, 'rectangle', 55, 48, '#76503d', {
      width: 12,
      height: 82,
    }),
  ],
});

registerObjectTemplate({
  id: 'chair',
  label: 'Chair',
  createComponents: (id) => [
    component(`${id}_seat`, 'rectangle', 0, 0, '#56778b', {
      width: 68,
      height: 16,
    }),
    component(`${id}_back`, 'rectangle', 0, -36, '#678ca1', {
      width: 68,
      height: 16,
    }),
    component(`${id}_leg_left`, 'rectangle', -24, 28, '#4d5259', {
      width: 8,
      height: 55,
    }),
    component(`${id}_leg_right`, 'rectangle', 24, 28, '#4d5259', {
      width: 8,
      height: 55,
    }),
  ],
});

registerObjectTemplate({
  id: 'bicycle',
  label: 'Bicycle',
  anchors: [{ id: 'seat', x: -42, y: -42, rotation: 0 }],
  createComponents: (id) => [
    component(`${id}_rear_wheel`, 'circle', -65, 22, '#333a44', {
      radius: 38,
    }),
    component(`${id}_front_wheel`, 'circle', 65, 22, '#333a44', {
      radius: 38,
    }),
    component(`${id}_rear_spoke_a`, 'rectangle', 0, 0, '#bbc3cc', {
      width: 3,
      height: 62,
    }, `${id}_rear_wheel`, 18),
    component(`${id}_rear_spoke_b`, 'rectangle', 0, 0, '#bbc3cc', {
      width: 3,
      height: 62,
    }, `${id}_rear_wheel`, 78),
    component(`${id}_rear_spoke_c`, 'rectangle', 0, 0, '#bbc3cc', {
      width: 3,
      height: 62,
    }, `${id}_rear_wheel`, 138),
    component(`${id}_front_spoke_a`, 'rectangle', 0, 0, '#bbc3cc', {
      width: 3,
      height: 62,
    }, `${id}_front_wheel`, 18),
    component(`${id}_front_spoke_b`, 'rectangle', 0, 0, '#bbc3cc', {
      width: 3,
      height: 62,
    }, `${id}_front_wheel`, 78),
    component(`${id}_front_spoke_c`, 'rectangle', 0, 0, '#bbc3cc', {
      width: 3,
      height: 62,
    }, `${id}_front_wheel`, 138),
    component(`${id}_frame_top`, 'rectangle', 0, -7, '#dc654f', {
      width: 78,
      height: 8,
    }, null, 8),
    component(`${id}_frame_down`, 'rectangle', 0, 27, '#dc654f', {
      width: 79,
      height: 8,
    }, null, -8),
    component(`${id}_frame_rear`, 'rectangle', -32, 24, '#dc654f', {
      width: 73,
      height: 8,
    }, null, -35),
    component(`${id}_frame_front`, 'rectangle', 34, 23, '#dc654f', {
      width: 74,
      height: 8,
    }, null, 34),
    component(`${id}_seat_post`, 'rectangle', -31, -22, '#555b66', {
      width: 7,
      height: 34,
    }, null, -14),
    component(`${id}_seat`, 'rectangle', -42, -42, '#292e38', {
      width: 42,
      height: 9,
      cornerRadius: 4,
    }),
    component(`${id}_handle_post`, 'rectangle', 40, -18, '#555b66', {
      width: 7,
      height: 39,
    }, null, 14),
    component(`${id}_handlebar`, 'rectangle', 51, -35, '#292e38', {
      width: 39,
      height: 8,
    }),
    component(`${id}_pedal_crank`, 'rectangle', 0, 28, '#777e88', {
      width: 44,
      height: 5,
    }),
    component(`${id}_pedal_left`, 'rectangle', -24, 9, '#292e38', {
      width: 19,
      height: 6,
    }, `${id}_pedal_crank`),
    component(`${id}_pedal_right`, 'rectangle', 24, -9, '#292e38', {
      width: 19,
      height: 6,
    }, `${id}_pedal_crank`),
  ],
});

export function getObjectTemplateRegistry() {
  return [...templates.values()].map((template) => ({
    id: template.id,
    label: template.label,
    anchors: (template.anchors ?? []).map((anchor) => anchor.id),
    components: template.createComponents('{objectId}').map((item) => ({
      id: item.id.replace('{objectId}_', ''),
      parentId: item.parentId?.replace('{objectId}_', '') ?? null,
      type: item.type,
      x: item.x,
      y: item.y,
      rotation: item.rotation,
      ...(item.width === undefined ? {} : { width: item.width }),
      ...(item.height === undefined ? {} : { height: item.height }),
      ...(item.radius === undefined ? {} : { radius: item.radius }),
    })),
  }));
}

export function createObjectFromTemplate(templateId, id, x, y, name) {
  const template = templates.get(templateId);
  if (!template) {
    throw new Error(`Unknown object template "${templateId}".`);
  }
  return {
    id,
    type: 'assembly',
    name: name?.trim() || `${template.label} ${id}`,
    x,
    y,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    ...(template.anchors ? { anchors: template.anchors } : {}),
    components: template.createComponents(id),
  };
}
