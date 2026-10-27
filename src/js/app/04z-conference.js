/* ==========================================================================
   Qelemchi · official conference templates
   The CVPR and NeurIPS author kits are injected by build.mjs from
   src/templates/{cvpr,neurips}. Keeping them out of 04-samples.js makes the
   bundled starter projects easy to audit against the upstream author kits.
   ========================================================================== */

const CONFERENCE_KITS = __CONFERENCE_KITS__;

const CONFERENCE_TEMPLATE_INFO = {
  cvpr: {
    name: 'CVPR 2026',
    description: 'IEEE/CVF 计算机视觉与模式识别会议官方作者套件'
  },
  neurips: {
    name: 'NeurIPS 2025',
    description: '神经信息处理系统大会官方样式与示例论文'
  }
};

(function registerConferenceTemplates() {
  const kits = CONFERENCE_KITS || {};
  for (const id of ['cvpr', 'neurips']) {
    const kit = kits[id];
    if (!kit || !Array.isArray(kit.files) || !kit.files.length) continue;
    const info = CONFERENCE_TEMPLATE_INFO[id];
    TEMPLATES[id] = {
      id,
      name: info.name,
      description: info.description,
      mainPath: kit.mainPath || 'main.tex',
      files: kit.files.map((f) => ({ path: f.path, text: f.text }))
    };
  }
})();
