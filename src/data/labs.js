// Clinical content for each lab. Every string here is displayed to users.
// Wording follows AJCC 8th edition (2017) for staging.
// Scene units are centimetres; exports convert to millimetres.

export const KIDNEY_DIMS_CM = { length: 11, width: 6, thickness: 3 } // Gray's / Moore typical adult

const kidneyParts = [
  { id: 'kidney_body', name: 'Kidney', removable: false, defaultColor: '#8a3b32',
    tooltip: 'The kidney: about 11 × 6 × 3 cm, retroperitoneal at T12–L3, with the right kidney sitting slightly lower than the left because of the liver.' },
  { id: 'renal_cortex', name: 'Renal cortex', removable: false, defaultColor: '#b0614f',
    tooltip: 'The pale outer layer containing glomeruli and convoluted tubules, extending inward between the pyramids as renal columns. Most renal cell carcinomas arise here.' },
  { id: 'renal_medulla', name: 'Renal pyramids (medulla)', removable: true, defaultColor: '#64271f',
    tooltip: 'Cone-shaped pyramids whose striped look comes from straight tubules and collecting ducts. Each tip (papilla) drains urine into a minor calyx.' },
  { id: 'renal_sinus', name: 'Renal sinus fat', removable: true, defaultColor: '#efd57e',
    tooltip: 'The fat-filled space around the pelvis, calyces and vessels inside the kidney. Tumour invasion of this fat makes a tumour T3a.' },
  { id: 'renal_pelvis', name: 'Renal pelvis and calyces', removable: true, defaultColor: '#ece7da',
    tooltip: 'The collecting system: minor calyces cup each papilla, join into major calyces, then the funnel-shaped renal pelvis, which narrows into the ureter. Posterior-most structure at the hilum.' },
  { id: 'adrenal_gland', name: 'Adrenal (suprarenal) gland', removable: true, defaultColor: '#d9a53c',
    tooltip: 'An endocrine gland on the superomedial pole of each kidney: yellow cortex (steroids) around a darker medulla (adrenaline). It sits inside Gerota’s fascia but in its own compartment; direct tumour invasion of it is T4.' },
  { id: 'renal_artery', name: 'Renal artery', removable: true, defaultColor: '#c0392b',
    tooltip: 'A branch of the abdominal aorta at about L1–L2 carrying roughly 20–25% of cardiac output. It divides into segmental end-arteries inside the sinus. Middle structure at the hilum.' },
  { id: 'renal_vein', name: 'Renal vein', removable: true, defaultColor: '#2e5c9e',
    tooltip: 'Drains into the IVC. Anterior-most structure at the hilum (front to back: vein, artery, pelvis). Tumour growth into it is T3a.' },
  { id: 'ureter', name: 'Ureter', removable: true, defaultColor: '#ece7da',
    tooltip: 'A muscular tube about 25–30 cm long carrying urine from the renal pelvis to the bladder by peristalsis.' },
  { id: 'tumor', name: 'Tumour (clear cell RCC)', removable: true, defaultColor: '#dda033',
    tooltip: 'Clear cell renal cell carcinoma: a well-circumscribed, golden-yellow cortical mass that bulges from the kidney contour. The cut surface is variegated with haemorrhage.' },
  { id: 'vein_thrombus', name: 'Renal vein tumour thrombus', removable: true, defaultColor: '#cf9233',
    tooltip: 'Solid tumour growing along the renal vein, visible at its cut end. Any extension into the renal vein or its segmental branches makes the tumour T3a.' },
  { id: 'anterior_half', name: 'Front half', removable: true, noColour: true, defaultColor: '#b0614f',
    tooltip: 'The front half of the kidney. Click to open or close it.' },
]

// sizeCm is tumour greatest dimension. position is centre in scene cm, kidney centred at origin,
// long axis along Y, hilum facing -X (medial), anterior is +Z.
const kidneyStages = [
  { id: 'normal', label: 'Normal', sizeCm: 0, ajcc: null, parts: [],
    readout: 'Healthy adult kidney, about 11 × 6 × 3 cm. No mass.',
    teaching: 'Baseline for comparison. Identify cortex, medulla, pelvis and the hilar order: vein, artery, pelvis from front to back.' },
  { id: 't1a', label: 'T1a', sizeCm: 3.0, ajcc: 'T1a', parts: ['tumor'],
    position: [0.8, 3.6, 0.9],
    readout: '3.0 cm tumour, upper pole, limited to the kidney. AJCC 8th: T1a is ≤4 cm in greatest dimension, limited to the kidney.',
    teaching: 'A small renal mass. Partial nephrectomy is preferred; thermal ablation or active surveillance are options, especially under 3 cm. About 20% of small renal masses are benign.' },
  { id: 't1b', label: 'T1b', sizeCm: 5.5, ajcc: 'T1b', parts: ['tumor'],
    position: [1.0, 3.2, 1.1],
    readout: '5.5 cm tumour, upper pole, limited to the kidney. AJCC 8th: T1b is >4 cm but ≤7 cm, limited to the kidney.',
    teaching: 'Partial nephrectomy where technically feasible, otherwise radical nephrectomy. Nephrometry scores (R.E.N.A.L., PADUA) estimate partial-nephrectomy complexity.' },
  { id: 't2a', label: 'T2a', sizeCm: 8.5, ajcc: 'T2a', parts: ['tumor'],
    position: [1.4, 2.4, 1.4],
    readout: '8.5 cm tumour, upper pole, still limited to the kidney. AJCC 8th: T2a is >7 cm but ≤10 cm, limited to the kidney.',
    teaching: 'Radical nephrectomy is standard, usually minimally invasive. The 4 / 7 / 10 cm cutoffs are greatest dimension, not volume.' },
  { id: 't3a', label: 'T3a', sizeCm: 6.0, ajcc: 'T3a', parts: ['tumor', 'vein_thrombus'],
    position: [0.6, 1.6, 1.2],
    readout: '6.0 cm upper-pole tumour extending into the renal vein and renal sinus fat. AJCC 8th: T3a is extension into the renal vein or its segmental branches, the pelvicalyceal system, or perirenal/renal sinus fat, but not beyond Gerota\u2019s fascia.',
    teaching: 'Staging is now anatomical, not size-based. Venous thrombus level (Mayo 0–IV) dictates the surgical approach; renal-vein-only thrombus can be ligated at the hilum, IVC thrombus needs caval control. A left-sided tumour can present as a non-decompressing left varicocele.' },
]

export const ajccTable = [
  ['T1a', 'Tumour ≤4 cm in greatest dimension, limited to the kidney'],
  ['T1b', 'Tumour >4 cm but ≤7 cm in greatest dimension, limited to the kidney'],
  ['T2a', 'Tumour >7 cm but ≤10 cm in greatest dimension, limited to the kidney'],
  ['T2b', 'Tumour >10 cm, limited to the kidney'],
  ['T3a', 'Extends into the renal vein or its segmental branches, or invades the pelvicalyceal system, or invades perirenal and/or renal sinus fat but not beyond Gerota\u2019s fascia'],
  ['T3b', 'Extends into the vena cava below the diaphragm'],
  ['T3c', 'Extends into the vena cava above the diaphragm or invades the wall of the vena cava'],
  ['T4', 'Invades beyond Gerota\u2019s fascia (including contiguous extension into the ipsilateral adrenal gland)'],
]

export const stageGrouping = [
  ['Stage I', 'T1 N0 M0'], ['Stage II', 'T2 N0 M0'],
  ['Stage III', 'T1–T2 N1 M0; T3 N0–N1 M0'], ['Stage IV', 'T4 any N M0; any T any N M1'],
]

export const labs = {
  kidney: {
    id: 'kidney',
    name: 'Kidney',
    condition: 'Renal cell carcinoma (clear cell)',
    description: 'A kidney with a removable tumour at four AJCC T stages, plus a normal kidney for comparison.',
    comingSoon: false,
    parts: kidneyParts,
    // the part the rest of the model sits on, per cutaway
    basePart: { full: 'kidney_body', coronal: 'renal_cortex' },
    defaultStage: 't1b',   // open on the stage that is printed for the demo
    stages: kidneyStages,
    cutaways: [
      { id: 'full', label: 'Whole kidney' },
      { id: 'coronal', label: 'Coronal section' },
    ],
    facts: {
      dimensions: 'Adult kidney: length 10–12 cm, width 5–7 cm, thickness about 3 cm, weight roughly 125–170 g.',
      hilum: 'Hilum faces anteromedially. Front to back: renal vein, renal artery, renal pelvis ("VAP"). A posterior segmental artery often runs behind the pelvis.',
      subtypes: 'Clear cell about 70–75% of RCC; papillary 10–15%; chromophobe about 5%.',
      detection: 'Most RCCs are now found incidentally on imaging; the classic triad (flank pain, haematuria, palpable mass) occurs in under 10% and implies advanced disease.',
      genetics: 'VHL tumour suppressor on 3p25; loss leads to HIF accumulation, VEGF drive and a hypervascular tumour.',
      paraneoplastic: 'Hypercalcaemia (PTHrP), polycythaemia (EPO), hypertension (renin), Stauffer syndrome, fever, weight loss.',
      survival: 'American Cancer Society 5-year relative survival by SEER stage: localized ~93%, regional ~74%, distant ~17%. Not AJCC stages.',
    },
    sources: [
      'AJCC Cancer Staging Manual, 8th ed. (2017), Kidney chapter, as reproduced in NCCN Kidney Cancer guidelines.',
      'Robbins & Cotran Pathologic Basis of Disease, renal neoplasms.',
      'Gray\u2019s Anatomy / Moore Clinically Oriented Anatomy, kidney and ureter.',
      'AUA 2021 and EAU guidelines on localized renal masses.',
      'Knoedler M et al. Urology 2015;85:1257–61; Bernhard JC et al. World J Urol 2016;34:337–45 (3D-printed kidney tumour models in education).',
    ],
  },
  aorta:  { id: 'aorta',  name: 'Aorta',  condition: 'Arch branching variants', comingSoon: true },
  femur:  { id: 'femur',  name: 'Femur',  condition: 'Fracture patterns',       comingSoon: true },
  spine: {
    id: 'spine', name: 'Lumbar spine', condition: 'L4–L5 disc herniation and surgery', comingSoon: false,
    description: 'A left paracentral L4–L5 disc extrusion, then the two operations used to treat it.',
    parts: [
      { id: 'l4_vertebra', name: 'L4 vertebra', removable: true, defaultColor: '#e6d9bf', tooltip: 'Fourth lumbar vertebra: body in front, and behind it the pedicles, laminae, facet joints, transverse and spinous processes that enclose the spinal canal.' },
      { id: 'l5_vertebra', name: 'L5 vertebra', removable: true, defaultColor: '#e2d4b8', tooltip: 'Fifth lumbar vertebra. Its pedicles are the widest in the lumbar spine.' },
      { id: 'annulus_fibrosus', name: 'Annulus fibrosus', removable: true, defaultColor: '#cfd8dc', tooltip: 'The tough outer rings of the disc. A tear lets the nucleus herniate, most often posterolaterally where the posterior longitudinal ligament is thinnest.' },
      { id: 'nucleus_pulposus', name: 'Nucleus pulposus', removable: true, defaultColor: '#9fb8c8', tooltip: 'The gel core of the disc that spreads load. Removed during a discectomy for fusion.' },
      { id: 'disc_herniation', name: 'Disc extrusion', removable: true, defaultColor: '#7f9fbc', tooltip: 'Nucleus material extruded through the annular tear into the canal, compressing the traversing (L5) nerve root.' },
      { id: 'thecal_sac', name: 'Thecal sac', removable: true, defaultColor: '#e9d27a', tooltip: 'The dural sac containing the cauda equina at this level (the spinal cord ends around L1–L2).' },
      { id: 'nerve_roots', name: 'Nerve roots', removable: true, defaultColor: '#f0d060', tooltip: 'The L4 roots exit below the L4 pedicles; the L5 roots traverse this disc level and exit below L5.' },
      { id: 'l5_nerve_root_left', name: 'Left L5 nerve root (compressed)', removable: true, defaultColor: '#f5c040', tooltip: 'The traversing root compressed by a paracentral L4–L5 herniation: L5 radiculopathy, with weakness of ankle dorsiflexion and great-toe extension and numbness over the dorsum of the foot.' },
      { id: 'pedicle_screws', name: 'Pedicle screws', removable: true, defaultColor: '#b8bec6', tooltip: 'Titanium screws passed through each pedicle into the vertebral body, converging medially. A medial breach risks the nerve root or dura.' },
      { id: 'rods', name: 'Rods', removable: true, defaultColor: '#c5cbd2', tooltip: 'Titanium rods locked into the screw heads, holding L4 and L5 still while the bone fuses.' },
      { id: 'interbody_cage', name: 'Interbody cage', removable: true, defaultColor: '#cdbfa4', tooltip: 'A curved PEEK cage placed through the transforaminal window after discectomy. It restores disc height and holds bone graft; the serrated faces resist migration.' },
      { id: 'bone_graft', name: 'Bone graft', removable: true, defaultColor: '#e8d7b0', tooltip: 'Graft packed in and around the cage; fusion is bone growing across the disc space through it.' },
    ],
    stages: [
      { id: 'preop', label: 'Pre-op', sizeCm: 0, parts: ['disc_herniation'],
        readout: 'Left paracentral L4–L5 disc extrusion: nucleus pulposus has herniated through an annular tear into the spinal canal, compressing the traversing left L5 nerve root.',
        teaching: 'L5 radiculopathy: pain down the lateral leg to the dorsum of the foot, weakness of ankle dorsiflexion and great-toe extension, positive straight-leg raise. Most patients improve with conservative care over 6–12 weeks.' },
      { id: 'discectomy', label: 'Microdiscectomy', sizeCm: 0, parts: [],
        readout: 'Left L4–L5 microdiscectomy: a small window in the L4 lamina (hemilaminotomy) exposes the root, the extruded fragment is removed through the annular tear, and the L5 root is decompressed. Disc and facet joints are preserved.',
        teaching: 'The standard operation for persistent radiculopathy or progressive weakness after failed conservative care; urgent for cauda equina syndrome. Recurrent herniation occurs in a minority of patients.' },
      { id: 'tlif', label: 'TLIF fusion', sizeCm: 0, parts: ['pedicle_screws', 'rods', 'interbody_cage', 'bone_graft'],
        readout: 'Left transforaminal lumbar interbody fusion (TLIF) at L4–L5: the left facet joint is removed, the disc is cleared, a curved interbody cage with bone graft restores disc height, and bilateral pedicle screws and rods hold the segment while it fuses.',
        teaching: 'Fusion is not first-line for a simple herniation. Typical indications are recurrent herniation, segmental instability or spondylolisthesis, and deformity.' },
    ],
    cutaways: [{ id: 'full', label: 'Whole segment' }],
    basePart: { full: 'l5_vertebra' },
    sources: ['Base anatomy generated during HackRPI 2026; implant placement from the model\u2019s own pedicles.', 'NASS clinical guideline: diagnosis and treatment of lumbar disc herniation with radiculopathy.'],
  },
  artery: { id: 'artery', name: 'Artery', condition: 'Atherosclerosis',         comingSoon: true },
}

export const getLab = (id) => labs[id]
export const getStage = (labId, stageId) => labs[labId]?.stages?.find((s) => s.id === stageId)
export const getPart = (labId, partId) => labs[labId]?.parts?.find((p) => p.id === partId)
