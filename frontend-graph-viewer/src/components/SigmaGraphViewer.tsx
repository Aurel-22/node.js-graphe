import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import Sigma from 'sigma';
import { NodeCircleProgram, createNodeCompoundProgram } from 'sigma/rendering';
import { createNodeImageProgram } from '@sigma/node-image';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import FpsCounter from './FpsCounter';
import './SigmaGraphViewer.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import type { GraphData, GraphNode } from '../types/graph';
import { nodePositionCache } from '../services/nodePositionCache';

interface SigmaGraphViewerProps {
  data: GraphData | null;
  graphId?: string;
}

const NODE_COLORS: Record<string, string> = {
  // Types de workflow
  start: '#4CAF50',      // Vert
  end: '#F44336',        // Rouge
  error: '#FF5722',      // Orange foncé
  decision: '#FF9800',   // Orange
  process: '#2196F3',    // Bleu
  
  // Types supplémentaires
  action: '#9C27B0',     // Violet
  validation: '#00BCD4', // Cyan
  data: '#8BC34A',       // Vert clair
  api: '#FFC107',        // Jaune
  database: '#795548',   // Marron
  service: '#607D8B',    // Gris bleu
  user: '#E91E63',       // Rose
  system: '#673AB7',     // Violet foncé
  notification: '#FFEB3B', // Jaune vif
  log: '#9E9E9E',        // Gris
  queue: '#FF5722',      // Orange rouge
  timer: '#00E676',      // Vert néon
  condition: '#FF6F00',  // Orange foncé
  loop: '#536DFE',       // Bleu indigo
  merge: '#651FFF',      // Violet profond
  split: '#00B0FF',      // Bleu clair
  
  // Infrastructure & DevOps
  gateway: '#26A69A',    // Teal
  cache: '#FF7043',      // Orange profond
  scheduler: '#AB47BC',  // Violet clair
  monitor: '#42A5F5',    // Bleu clair
  storage: '#8D6E63',    // Marron clair
  proxy: '#78909C',      // Bleu gris
  worker: '#EF5350',     // Rouge clair
  broker: '#66BB6A',     // Vert moyen
  registry: '#5C6BC0',   // Indigo
  controller: '#FFCA28', // Jaune doré
  
  // Défaut
  default: '#9E9E9E',
};

// Générateur de couleur déterministe pour types inconnus
const generateColorFromString = (str: string): string => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  // Générer une couleur vive et contrastée
  const h = Math.abs(hash % 360);
  const s = 65 + (Math.abs(hash) % 20); // 65-85%
  const l = 50 + (Math.abs(hash >> 8) % 15); // 50-65%
  
  return `hsl(${h}, ${s}%, ${l}%)`;
};

// ─── Iconify API: 200 000+ icons from 150+ collections ───
// Helpers per collection
const mdi    = (n: string) => `https://api.iconify.design/mdi/${n}.svg`;
const ph     = (n: string) => `https://api.iconify.design/ph/${n}.svg`;
const tabler = (n: string) => `https://api.iconify.design/tabler/${n}.svg`;
const lucide = (n: string) => `https://api.iconify.design/lucide/${n}.svg`;
const carbon = (n: string) => `https://api.iconify.design/carbon/${n}.svg`;
const fluent = (n: string) => `https://api.iconify.design/fluent/${n}.svg`;
const si     = (n: string) => `https://api.iconify.design/simple-icons/${n}.svg`;      // real brand logos
const game   = (n: string) => `https://api.iconify.design/game-icons/${n}.svg`;         // 4000+ unique icons
const ic     = (n: string) => `https://api.iconify.design/ic/${n}.svg`;                 // Google Material
const bi     = (n: string) => `https://api.iconify.design/bi/${n}.svg`;                 // Bootstrap via Iconify
const ri     = (n: string) => `https://api.iconify.design/ri/${n}.svg`;                 // Remix Icon
const fa6    = (n: string) => `https://api.iconify.design/fa6-solid/${n}.svg`;          // Font Awesome 6

// ── Explicit type → icon (~250 semantic mappings using mixed collections) ──
const NODE_ICONS: Record<string, string> = {

  // ══════════ Workflow / Process ══════════
  start: mdi('play-circle-outline'), end: mdi('stop-circle-outline'), error: mdi('alert-circle'),
  decision: mdi('source-branch'), process: tabler('settings-automation'), action: mdi('flash'),
  validation: mdi('check-decagram'), condition: mdi('help-circle-outline'), loop: mdi('refresh'),
  merge: mdi('source-merge'), split: mdi('source-fork'), timer: mdi('timer-outline'),
  trigger: mdi('bell-ring-outline'), callback: mdi('phone-return'), retry: mdi('reload'),
  timeout: mdi('timer-sand'), delay: mdi('clock-time-four-outline'), parallel: mdi('arrow-split-vertical'),
  fork: mdi('directions-fork'), join: mdi('merge'), subprocess: mdi('subdirectory-arrow-right'),
  workflow: tabler('git-merge'), task: mdi('checkbox-marked-circle-outline'), step: mdi('debug-step-over'),
  phase: mdi('layers-triple'), milestone: mdi('flag-triangle'), checkpoint: mdi('flag-checkered'),
  approval: mdi('thumb-up-outline'), rejection: mdi('thumb-down-outline'), review: mdi('eye-outline'),
  complete: mdi('check-circle'), cancel: mdi('close-circle'), pause: mdi('pause-circle-outline'),
  resume: mdi('play-outline'), skip: mdi('skip-next'), signal: lucide('radio'),
  semaphore: mdi('traffic-light'), state_machine: tabler('replace'), orchestration: carbon('flow'),
  choreography: mdi('human-queue'), saga: tabler('chart-sankey'), compensate: mdi('undo-variant'),
  escalation: mdi('arrow-top-right-bold-outline'), handoff: mdi('hand-pointing-right'),

  // ══════════ Data / Storage ══════════
  data: mdi('database'), database: mdi('database-cog'), storage: mdi('harddisk'),
  cache: mdi('cached'), file: tabler('file'), folder: tabler('folder'),
  archive: mdi('archive'), backup: mdi('cloud-upload'), export: mdi('export'),
  import: mdi('import'), document: mdi('file-document-outline'), spreadsheet: mdi('file-excel'),
  image: mdi('file-image'), pdf: mdi('file-pdf-box'), json: mdi('code-json'),
  xml: mdi('file-xml-box'), csv: mdi('file-delimited'), sql: carbon('sql'),
  table: mdi('table'), record: mdi('card-text-outline'), schema: mdi('sitemap-outline'),
  index: mdi('sort-alphabetical-ascending'), blob: mdi('cloud-outline'), bucket: mdi('pail'),
  volume: mdi('harddisk'), snapshot: mdi('camera'), replica: mdi('content-copy'),
  shard: mdi('chart-pie'), partition: mdi('view-column'), datalake: carbon('data-base'),
  datamart: carbon('data-set'), etl: carbon('data-refinery'), warehouse_data: mdi('warehouse'),
  nosql: mdi('database-search'), timeseries: mdi('chart-timeline-variant'), graph_db: mdi('graph-outline'),
  vector_db: carbon('data-vis-4'), key_value: mdi('key-chain'), column_store: mdi('view-column-outline'),

  // ══════════ Real Tech Logos (simple-icons) ══════════
  docker: si('docker'), kubernetes: si('kubernetes'), terraform: si('terraform'),
  ansible: si('ansible'), jenkins: si('jenkins'), github: si('github'),
  gitlab: si('gitlab'), bitbucket: si('bitbucket'), azure: si('microsoftazure'),
  aws: si('amazonaws'), gcp: si('googlecloud'), firebase: si('firebase'),
  vercel: si('vercel'), netlify: si('netlify'), heroku: si('heroku'),
  digitalocean: si('digitalocean'), cloudflare: si('cloudflare'), nginx: si('nginx'),
  apache: si('apache'), caddy: si('caddy'), traefik: si('traefikproxy'),
  postgresql: si('postgresql'), mysql: si('mysql'), mongodb: si('mongodb'),
  redis: si('redis'), elasticsearch: si('elasticsearch'), cassandra: si('apachecassandra'),
  neo4j: si('neo4j'), graphql: si('graphql'), kafka: si('apachekafka'),
  rabbitmq: si('rabbitmq'), nats: si('nats'), pulsar: si('apachepulsar'),
  nodejs: si('nodedotjs'), python: si('python'), java: si('openjdk'),
  typescript: si('typescript'), javascript: si('javascript'), rust: si('rust'),
  go: si('go'), csharp: si('csharp'), swift: si('swift'),
  kotlin: si('kotlin'), ruby: si('ruby'), php: si('php'),
  react: si('react'), vue: si('vuedotjs'), angular: si('angular'),
  svelte: si('svelte'), nextjs: si('nextdotjs'), nuxt: si('nuxtdotjs'),
  express: si('express'), fastapi: si('fastapi'), spring: si('spring'),
  django: si('django'), flask: si('flask'), rails: si('rubyonrails'),
  linux: si('linux'), ubuntu: si('ubuntu'), debian: si('debian'),
  redhat: si('redhat'), windows: si('windows'), macos: si('apple'),
  prometheus: si('prometheus'), grafana: si('grafana'), datadog: si('datadog'),
  splunk: si('splunk'), newrelic: si('newrelic'), kibana: si('kibana'),
  terraform_cloud: si('terraform'), vault: si('vault'), consul: si('consul'),
  istio: si('istio'), envoy: si('envoyproxy'), linkerd: si('linkerd'),
  helm: si('helm'), argocd: si('argo'), circleci: si('circleci'),
  travisci: si('travisci'), drone: si('drone'), sonarqube: si('sonarqube'),
  sentry: si('sentry'), pagerduty: si('pagerduty'), slack: si('slack'),
  discord: si('discord'), teams: si('microsoftteams'), jira: si('jira'),
  confluence: si('confluence'), notion: si('notion'), trello: si('trello'),
  figma: si('figma'), storybook: si('storybook'), chromatic: si('chromatic'),
  webpack: si('webpack'), vite: si('vite'), rollup: si('rollupdotjs'),
  esbuild: si('esbuild'), babel: si('babel'), eslint: si('eslint'),
  prettier: si('prettier'), jest: si('jest'), cypress: si('cypress'),
  playwright: si('playwright'), selenium: si('selenium'), postman: si('postman'),
  swagger: si('swagger'), openapi: si('openapiinitiative'),
  stripe: si('stripe'), paypal: si('paypal'), shopify: si('shopify'),
  twilio: si('twilio'), sendgrid: si('sendgrid'), mailchimp: si('mailchimp'),
  auth0: si('auth0'), okta: si('okta'), keycloak: si('keycloak'),
  minio: si('minio'), ceph: si('ceph'), etcd: si('etcd'),
  zookeeper: si('apachezookeeper'), airflow: si('apacheairflow'), spark: si('apachespark'),
  flink: si('apacheflink'), hadoop: si('apachehadoop'), hive: si('apachehive'),
  presto: si('prestodb'), dbt: si('dbt'), snowflake: si('snowflake'),
  bigquery: si('googlebigquery'), redshift: si('amazonredshift'),
  openai: si('openai'), huggingface: si('huggingface'), tensorflow: si('tensorflow'),
  pytorch: si('pytorch'), jupyter: si('jupyter'), anaconda: si('anaconda'),
  npm: si('npm'), yarn: si('yarn'), pnpm: si('pnpm'), pip: si('pypi'),
  homebrew: si('homebrew'), apt: si('debian'), git: si('git'),
  tailwindcss: si('tailwindcss'), sass: si('sass'), bootstrap: si('bootstrap'),
  materialui: si('mui'), antdesign: si('antdesign'),

  // ══════════ Infrastructure / DevOps (generic icons) ══════════
  gateway: tabler('router'), proxy: mdi('shield-half-full'), monitor: mdi('monitor-dashboard'),
  scheduler: mdi('calendar-clock'), worker: tabler('hammer'), broker: mdi('swap-horizontal-bold'),
  registry: mdi('book-open-variant'), controller: mdi('tune-vertical-variant'),
  'load-balancer': mdi('scale-balance'), firewall: mdi('shield-lock'),
  dns: mdi('dns'), cdn: mdi('earth-arrow-right'), container: carbon('container-software'),
  pod: carbon('kubernetes-pod'), cluster: carbon('cluster'), node: carbon('edge-node'),
  vm: mdi('monitor'), instance: mdi('window-restore'), server: tabler('server'),
  host: mdi('desktop-classic'), rack: mdi('server-network'), datacenter: mdi('office-building'),
  region: mdi('earth'), zone: mdi('map-marker-radius'), namespace: mdi('folder-network'),
  deployment: mdi('rocket-launch'), release: mdi('tag-outline'), build: tabler('hammer'),
  artifact: mdi('package-variant'), package: mdi('package'), image_container: mdi('disc'),
  pipeline: carbon('flow-data'), cicd: mdi('infinity'), service_mesh: carbon('network-3'),
  sidecar: mdi('car-side'), ingress: mdi('login'), egress: mdi('logout'),
  configmap: mdi('file-cog'), secret_k8s: mdi('file-lock'), crd: mdi('puzzle'),
  operator_k8s: mdi('cog-transfer'), daemonset: mdi('ghost'), statefulset: mdi('database-lock'),
  replicaset: mdi('content-duplicate'), cronjob: mdi('calendar-sync'), hpa: mdi('arrow-expand-vertical'),

  // ══════════ People / Organization ══════════
  user: mdi('account'), admin: mdi('account-cog'), team: mdi('account-group'),
  organization: mdi('domain'), customer: mdi('account-star'), manager: mdi('account-tie'),
  developer: mdi('code-braces'), operator: mdi('headphones'), guest: mdi('account-question'),
  member: mdi('account-check'), group: mdi('account-multiple'), role: mdi('account-key'),
  department: mdi('sitemap'), company: mdi('office-building-cog'), contact: mdi('card-account-details'),
  account: mdi('badge-account-horizontal'), profile: mdi('account-circle'), bot: mdi('robot'),
  stakeholder: mdi('account-tie-voice'), vendor: mdi('store'), partner: mdi('handshake'),
  consultant: mdi('account-tie-hat'), intern: mdi('school'), contractor: mdi('briefcase-account'),

  // ══════════ Communication / Messaging ══════════
  notification: mdi('bell-outline'), message: mdi('message-text'), email: mdi('email-outline'),
  alert: mdi('alert'), warning: mdi('alert-outline'), sms: mdi('cellphone-message'),
  webhook: mdi('webhook'), push: mdi('send'), broadcast: mdi('access-point'),
  channel: mdi('bullhorn'), topic: mdi('forum'), subscription: mdi('rss'),
  inbox: mdi('inbox'), outbox: mdi('send-check'), draft: mdi('pencil-outline'),
  template: mdi('file-document-edit-outline'), newsletter: mdi('newspaper'),
  chat: mdi('chat'), voip: mdi('phone-voip'), video_call: mdi('video'),
  conference: mdi('google-classroom'), announcement: mdi('bullhorn-variant'),

  // ══════════ Services / API ══════════
  api: mdi('api'), service: mdi('cloud-cog'), microservice: carbon('microservices-1'),
  endpoint: mdi('connection'), rest: mdi('web'), websocket: mdi('lan-connect'),
  grpc: carbon('api-1'), soap: mdi('file-code'), middleware: mdi('layers-triple-outline'),
  adapter: mdi('power-plug'), connector: mdi('link-variant'), integration: mdi('puzzle'),
  plugin: mdi('puzzle-plus'), extension: mdi('power-plug-outline'), sdk: mdi('tools'),
  library: tabler('books'), framework: carbon('model-builder'), module: mdi('view-module'),
  component: mdi('toy-brick'), widget: mdi('widgets'), saga_service: mdi('source-branch-sync'),
  facade: mdi('shield-outline'), gateway_api: mdi('transit-connection-variant'),
  circuit_breaker: mdi('flash-off'), rate_limiter: mdi('speedometer-slow'),
  health_check: mdi('heart-pulse'), service_discovery: mdi('radar'),

  // ══════════ Computing / Runtime ══════════
  system: mdi('desktop-tower'), compute: mdi('chip'), memory: mdi('memory'),
  function: mdi('function'), lambda: mdi('lambda'), serverless: mdi('cloud-sync'),
  thread: mdi('format-list-numbered'), process_exec: mdi('console'), runtime: mdi('play-box'),
  kernel: mdi('chip'), driver: mdi('usb-flash-drive'), firmware: mdi('integrated-circuit-chip'),
  os: mdi('monitor'), app: mdi('application'), daemon: mdi('ghost-outline'),
  cron: mdi('alarm'), job: mdi('briefcase'), batch: mdi('tray-full'),
  gpu: carbon('machine-learning-model'), tpu: carbon('ai-governance-lifecycle'),
  edge_compute: carbon('edge-node-alt'), quantum: carbon('chemistry'),
  wasm: tabler('brand-javascript'), sandbox: mdi('shield-bug-outline'),

  // ══════════ Security / Auth ══════════
  auth: mdi('lock-open'), token: mdi('shield-key'), certificate: mdi('certificate'),
  encryption: mdi('lock'), permission: mdi('key-variant'), secret: mdi('eye-off'),
  password: mdi('form-textbox-password'), oauth: mdi('shield-account'), sso: mdi('door-open'),
  mfa: mdi('two-factor-authentication'), audit: mdi('clipboard-check-outline'),
  compliance: mdi('check-decagram-outline'), vulnerability: mdi('bug'), threat: mdi('alert-decagram'),
  scan: mdi('magnify-scan'), policy: mdi('file-lock'), identity: mdi('fingerprint'),
  rbac: mdi('account-lock'), abac: mdi('shield-account-variant'), waf: mdi('shield-bug'),
  zero_trust: mdi('shield-check'), penetration: mdi('target-account'), siem: mdi('monitor-eye'),
  soar: mdi('robot-industrial'), xdr: mdi('shield-search'), dlp: mdi('file-eye'),

  // ══════════ Network ══════════
  network: mdi('lan'), ip: mdi('ip-network'), port: mdi('ethernet'),
  protocol: mdi('swap-vertical'), router_net: mdi('router-network'),
  switch_net: mdi('switch'), wifi: mdi('wifi'), bluetooth: mdi('bluetooth'),
  vpn: mdi('vpn'), load: mdi('speedometer'), bandwidth: mdi('gauge'),
  latency: mdi('timer-sand-complete'), packet: mdi('email-fast-outline'),
  socket: mdi('power-socket'), ssl: mdi('lock-check'), tls: mdi('shield-lock-outline'),
  subnet: mdi('ip-network-outline'), vlan: mdi('lan-pending'), peering: mdi('handshake-outline'),
  mesh: carbon('network-4'), overlay: mdi('layers'), nat: mdi('swap-horizontal'),
  arp: mdi('ethernet-cable'), bgp: mdi('routes'), tcp: mdi('connection'),
  udp: mdi('access-point-network'), http: mdi('web'), https: mdi('lock-check-outline'),
  dns_record: mdi('dns-outline'), cname: mdi('link-variant'), mx: mdi('email-check'),

  // ══════════ Monitoring / Logging / Observability ══════════
  log: mdi('text-box-search'), metric: mdi('chart-line'), trace: mdi('chart-timeline'),
  health: mdi('heart-pulse'), status: mdi('traffic-light'), dashboard: mdi('view-dashboard'),
  analytics: mdi('google-analytics'), report: mdi('file-chart'), graph: mdi('chart-areaspline'),
  chart: mdi('chart-bar'), kpi: mdi('bullseye-arrow'), sla: mdi('handshake'),
  uptime: mdi('arrow-up-bold-circle'), downtime: mdi('arrow-down-bold-circle'),
  incident: mdi('alert-octagram'), oncall: mdi('phone-in-talk'), pager: mdi('cellphone-wireless'),
  apm: carbon('application'), rum: mdi('account-eye'), synthetic: mdi('robot-outline'),
  anomaly: mdi('chart-bell-curve-cumulative'), baseline: mdi('chart-line-stacked'),
  threshold: mdi('gauge-low'), span: mdi('ray-start-end'), baggage: mdi('bag-personal'),

  // ══════════ Queue / Event / Streaming ══════════
  queue: mdi('tray-full'), event: mdi('calendar-star'), stream: mdi('waves'),
  bus: mdi('bus-articulated-front'), pubsub: mdi('bullhorn-outline'),
  consumer: mdi('download'), producer: mdi('upload'), subscriber: mdi('bell-ring'),
  publisher: mdi('send-circle'), dead_letter: mdi('email-off'), dlq: mdi('email-alert'),
  topic_partition: mdi('format-columns'), consumer_group: mdi('account-group-outline'),
  offset: mdi('counter'), replay: mdi('replay'), backpressure: mdi('gauge-full'),
  fifo: mdi('sort-ascending'), priority_queue: mdi('sort-variant'),
  event_sourcing: mdi('source-commit'), cqrs: mdi('call-split'),

  // ══════════ Business / Commerce ══════════
  order: mdi('cart'), payment: mdi('credit-card'), invoice: mdi('receipt'),
  product: mdi('package-variant-closed'), inventory: mdi('warehouse'),
  shipment: mdi('truck-delivery'), warehouse: mdi('warehouse'), supplier: mdi('store'),
  transaction: mdi('swap-horizontal-circle'), contract: mdi('file-sign'),
  budget: mdi('cash-multiple'), revenue: mdi('trending-up'), expense: mdi('cash-minus'),
  tax: mdi('percent'), discount: mdi('sale'), coupon: mdi('ticket-percent'),
  refund: mdi('cash-refund'), crm: mdi('account-heart'), erp: mdi('factory'),
  pos: mdi('point-of-sale'), b2b: mdi('domain'), b2c: mdi('account-cash'),
  marketplace: mdi('store-outline'), subscription_plan: mdi('credit-card-clock'),
  loyalty: mdi('medal'), churn: mdi('account-remove'), acquisition: mdi('account-plus'),

  // ══════════ Content / Media ══════════
  page: mdi('file-document'), post: mdi('pencil'), comment: mdi('comment-text'),
  blog: mdi('post'), article: mdi('newspaper-variant'), video: mdi('video'),
  audio: mdi('music'), photo: mdi('image'), gallery: mdi('image-multiple'),
  attachment: mdi('paperclip'), link: mdi('link'), embed: mdi('code-tags'),
  feed: mdi('rss'), cms: mdi('text-box-multiple'), podcast: mdi('podcast'),
  livestream: mdi('broadcast'), ebook: mdi('book-open-page-variant'),
  infographic: mdi('chart-infographic'), presentation: mdi('presentation'),
  whitepaper: mdi('file-document-outline'), webinar: mdi('cast-education'),

  // ══════════ Location / Geography ══════════
  location: mdi('map-marker'), address: mdi('home'), map: mdi('map'),
  country: mdi('flag-variant'), city: mdi('city-variant'), store_loc: mdi('storefront'),
  branch: mdi('source-branch-plus'), warehouse_loc: mdi('warehouse'),
  gps: mdi('crosshairs-gps'), coordinates: mdi('latitude'), geofence: mdi('map-marker-radius'),
  route: mdi('map-marker-path'), navigation: mdi('navigation-variant'), poi: mdi('map-marker-star'),

  // ══════════ AI / ML / Data Science ══════════
  model: carbon('machine-learning-model'), training: carbon('model-tuned'),
  inference: carbon('ai-status-complete'), dataset: carbon('data-set'),
  feature: carbon('data-enrichment'), pipeline_ml: carbon('flow-modeler'),
  experiment: carbon('chemistry'), notebook: mdi('notebook'), tensor: carbon('cube'),
  embedding: carbon('data-vis-4'), prompt: mdi('message-flash'), agent: mdi('robot-happy'),
  rag: mdi('database-search'), vector: carbon('vector'), fine_tune: mdi('tune'),
  tokenizer: mdi('format-letter-case'), llm: carbon('ai-governance'), diffusion: mdi('blur'),
  gan: mdi('image-auto-adjust'), transformer: carbon('transform-binary'),
  reinforcement: mdi('target'), classification: mdi('shape'), regression: mdi('chart-line-variant'),
  clustering: mdi('chart-bubble'), nlp: mdi('text-recognition'), cv: mdi('eye-circle'),
  recommendation: mdi('star-shooting'), anomaly_detection: mdi('alert-rhombus'),

  // ══════════ Testing / QA ══════════
  test: mdi('test-tube'), unit_test: mdi('test-tube'), integration_test: mdi('puzzle-check'),
  e2e_test: mdi('monitor-shimmer'), load_test: mdi('speedometer'), stress_test: mdi('flash-alert'),
  smoke_test: mdi('fire'), regression_test: mdi('history'), fixture: mdi('wrench'),
  mock: mdi('robot-vacuum'), stub: mdi('puzzle-star'), spy: mdi('eye-settings'),
  coverage: mdi('percent-circle'), assertion: mdi('check-bold'), benchmark: mdi('chart-timeline-variant-shimmer'),
  canary: mdi('bird'), blue_green: mdi('swap-horizontal-variant'), feature_flag: mdi('flag-variant-outline'),
  ab_test: mdi('ab-testing'), chaos: mdi('weather-lightning-rainy'),

  // ══════════ Miscellaneous / Programming ══════════
  config: mdi('cog'), settings: mdi('tune'), variable: mdi('variable'),
  constant: mdi('alpha-c-circle'), enum: mdi('format-list-numbered'), type: mdi('format-font'),
  class: mdi('file-code'), interface: mdi('xml'), trait: mdi('puzzle-heart'),
  entity: mdi('diamond-stone'), resource: mdi('diamond'), asset: mdi('treasure-chest'),
  tag: mdi('tag'), category: mdi('shape'), attribute: mdi('format-list-bulleted'),
  state: mdi('toggle-switch'), flag_misc: mdi('flag'), priority: mdi('star'),
  label: mdi('label'), note: mdi('note-text'), todo: mdi('format-list-checks'),
  idea: mdi('lightbulb-on'), question: mdi('help-circle'), info: mdi('information'),
  help: mdi('lifebuoy'), support: mdi('face-agent'), feedback: mdi('message-star'),
  annotation: mdi('message-bookmark'), dependency: mdi('graph'), version: mdi('source-commit'),
  migration: mdi('database-arrow-right'), deprecation: mdi('alert-minus'),
  refactor: mdi('file-replace'), debug: mdi('bug-outline'), profiler: mdi('speedometer-medium'),
  linter: mdi('broom'), formatter: mdi('auto-fix'), transpiler: mdi('translate'),

  // ── Default ──
  default: mdi('circle-outline'),
};

// ── Massive fallback pool: 500 icons from multiple Iconify collections ──
// Each entry is "collection/icon-name"
const FALLBACK_ICONS: string[] = [
  // ── Material Design Icons (mdi) ──
  'mdi/ab-testing', 'mdi/abacus', 'mdi/accordion', 'mdi/account-cowboy-hat', 'mdi/account-hard-hat',
  'mdi/airplane', 'mdi/alien', 'mdi/alpha-a-circle', 'mdi/ambulance', 'mdi/amplifier',
  'mdi/anchor', 'mdi/android', 'mdi/animation', 'mdi/anvil', 'mdi/apple',
  'mdi/application-brackets', 'mdi/arch', 'mdi/arm-flex', 'mdi/atm', 'mdi/atom',
  'mdi/auto-fix', 'mdi/axe', 'mdi/baby-carriage', 'mdi/badminton', 'mdi/balloon',
  'mdi/bank', 'mdi/barcode', 'mdi/barn', 'mdi/barrel', 'mdi/baseball-bat',
  'mdi/basketball', 'mdi/bat', 'mdi/battery', 'mdi/beach', 'mdi/beaker',
  'mdi/bed', 'mdi/bee', 'mdi/beer', 'mdi/bell-cog', 'mdi/bicycle',
  'mdi/binoculars', 'mdi/bird', 'mdi/blender', 'mdi/blood-bag', 'mdi/bone',
  'mdi/book-open-variant', 'mdi/bookmark-multiple', 'mdi/boom-gate', 'mdi/bow-arrow', 'mdi/bowling',
  'mdi/brain', 'mdi/bridge', 'mdi/brightness-7', 'mdi/broom', 'mdi/brush',
  'mdi/bucket-outline', 'mdi/bulldozer', 'mdi/bus', 'mdi/butterfly', 'mdi/cactus',
  'mdi/cake-variant', 'mdi/calculator', 'mdi/camcorder', 'mdi/camera-iris', 'mdi/campfire',
  'mdi/candle', 'mdi/candy', 'mdi/cannabis', 'mdi/car', 'mdi/cards-playing-outline',
  'mdi/carrot', 'mdi/castle', 'mdi/cat', 'mdi/cellphone', 'mdi/chandelier',
  'mdi/charity', 'mdi/chess-king', 'mdi/chess-knight', 'mdi/chess-queen', 'mdi/chess-rook',
  'mdi/chili-mild', 'mdi/church', 'mdi/cigar', 'mdi/circle-slice-8', 'mdi/clipboard-pulse',
  'mdi/clock-digital', 'mdi/clover', 'mdi/coach-lamp', 'mdi/coffee', 'mdi/coffin',
  'mdi/cog-transfer', 'mdi/compass', 'mdi/controller-classic', 'mdi/cookie', 'mdi/coolant-temperature',
  'mdi/corn', 'mdi/cow', 'mdi/crane', 'mdi/creation', 'mdi/cricket',
  'mdi/cross-bolnisi', 'mdi/crosshairs-gps', 'mdi/crown', 'mdi/crystal-ball', 'mdi/cube-outline',
  'mdi/cup', 'mdi/cupcake', 'mdi/currency-btc', 'mdi/cursor-default-click', 'mdi/dice-6',
  'mdi/dinosaur', 'mdi/diving', 'mdi/dna', 'mdi/dog', 'mdi/dolphin',
  'mdi/domino-mask', 'mdi/donkey', 'mdi/door', 'mdi/drama-masks', 'mdi/drawing',
  'mdi/dresser', 'mdi/drone', 'mdi/duck', 'mdi/dumbbell', 'mdi/ear-hearing',
  'mdi/earth-box', 'mdi/egg', 'mdi/eiffel-tower', 'mdi/elephant', 'mdi/elevator',
  'mdi/emoticon-cool', 'mdi/engine', 'mdi/ethereum', 'mdi/ev-station', 'mdi/excavator',
  'mdi/expansion-card', 'mdi/eye-arrow-right', 'mdi/face-recognition', 'mdi/fan', 'mdi/feather',
  'mdi/ferris-wheel', 'mdi/film', 'mdi/fire', 'mdi/fire-hydrant', 'mdi/firework',
  'mdi/fish', 'mdi/fishbowl', 'mdi/flask', 'mdi/floor-lamp', 'mdi/flower',
  'mdi/food-apple', 'mdi/football', 'mdi/forest', 'mdi/fountain', 'mdi/fridge',
  'mdi/fruit-cherries', 'mdi/frying-pan', 'mdi/fuel', 'mdi/gamepad-variant', 'mdi/garage',
  'mdi/gas-station', 'mdi/gate', 'mdi/glass-cocktail', 'mdi/globe-model', 'mdi/gold',
  'mdi/golf', 'mdi/gondola', 'mdi/grain', 'mdi/grave-stone', 'mdi/greenhouse',
  'mdi/guitar-acoustic', 'mdi/guy-fawkes-mask', 'mdi/hand-saw', 'mdi/hanger', 'mdi/hat-fedora',
  'mdi/head-cog', 'mdi/head-snowflake', 'mdi/heart-multiple', 'mdi/helicopter', 'mdi/highway',
  'mdi/hiking', 'mdi/hockey-sticks', 'mdi/home-city', 'mdi/hook', 'mdi/horseshoe',
  'mdi/hospital-building', 'mdi/hot-tub', 'mdi/hubspot', 'mdi/human-scooter', 'mdi/hydro-power',
  'mdi/ice-cream', 'mdi/ice-pop', 'mdi/incognito', 'mdi/infinity', 'mdi/island',

  // ── Tabler Icons ──
  'tabler/alien', 'tabler/anchor', 'tabler/antenna-bars-5', 'tabler/apple', 'tabler/atom',
  'tabler/award', 'tabler/axe', 'tabler/baby-carriage', 'tabler/badge', 'tabler/ball-basketball',
  'tabler/ball-football', 'tabler/ball-tennis', 'tabler/ballon', 'tabler/bandage', 'tabler/barbell',
  'tabler/barrel', 'tabler/bath', 'tabler/battery-charging', 'tabler/beach', 'tabler/bell-school',
  'tabler/bike', 'tabler/biohazard', 'tabler/blade', 'tabler/bolt', 'tabler/bomb',
  'tabler/bone', 'tabler/book', 'tabler/bottle', 'tabler/bow', 'tabler/brain',
  'tabler/brand-airbnb', 'tabler/brand-apple', 'tabler/brand-spotify', 'tabler/bread', 'tabler/briefcase',
  'tabler/brush', 'tabler/bucket', 'tabler/bug', 'tabler/building-bridge', 'tabler/building-castle',
  'tabler/building-church', 'tabler/building-factory', 'tabler/building-lighthouse', 'tabler/bulb', 'tabler/bus',
  'tabler/butterfly', 'tabler/cactus', 'tabler/cake', 'tabler/calculator', 'tabler/camera',
  'tabler/candle', 'tabler/candy', 'tabler/car', 'tabler/carrot', 'tabler/cat',
  'tabler/certificate', 'tabler/chess', 'tabler/christmas-tree', 'tabler/circle-dot', 'tabler/cloud-storm',
  'tabler/clover', 'tabler/coffee', 'tabler/coin', 'tabler/comet', 'tabler/compass',
  'tabler/confetti', 'tabler/cookie', 'tabler/cooker', 'tabler/copyright', 'tabler/crane',
  'tabler/creative-commons', 'tabler/cross', 'tabler/crown', 'tabler/crystal-ball', 'tabler/cup',
  'tabler/cut', 'tabler/deer', 'tabler/device-watch', 'tabler/diamond', 'tabler/dice',
  'tabler/dinosaur', 'tabler/disc', 'tabler/dog', 'tabler/door', 'tabler/drone',
  'tabler/droplet', 'tabler/ear', 'tabler/egg', 'tabler/engine', 'tabler/eye',
  'tabler/eyeglass', 'tabler/feather', 'tabler/fence', 'tabler/fidget-spinner', 'tabler/fire-hydrant',
  'tabler/fish', 'tabler/flag-3', 'tabler/flame', 'tabler/flask', 'tabler/flower',
  'tabler/focus', 'tabler/football', 'tabler/forklift', 'tabler/fountain', 'tabler/fridge',
  'tabler/gas-station', 'tabler/gauge', 'tabler/ghost', 'tabler/gift', 'tabler/glass',
  'tabler/globe', 'tabler/golf', 'tabler/gps', 'tabler/grain', 'tabler/guitar-pick',
  'tabler/heart-handshake', 'tabler/helicopter', 'tabler/hexagon', 'tabler/highway', 'tabler/horse',

  // ── Phosphor Icons (ph) ──
  'ph/acorn', 'ph/airplane', 'ph/alien', 'ph/anchor', 'ph/apple-logo',
  'ph/atom', 'ph/baby', 'ph/backpack', 'ph/balloon', 'ph/bandaids',
  'ph/barbell', 'ph/barricade', 'ph/baseball', 'ph/basketball', 'ph/bathtub',
  'ph/battery-charging', 'ph/beer-bottle', 'ph/bell-simple-ringing', 'ph/binoculars', 'ph/bird',
  'ph/boat', 'ph/bone', 'ph/book-open', 'ph/boot', 'ph/bounding-box',
  'ph/brain', 'ph/brandy', 'ph/bread', 'ph/bridge', 'ph/briefcase-metal',
  'ph/broadcast', 'ph/broom', 'ph/browser', 'ph/bug-beetle', 'ph/building-apartment',
  'ph/butterfly', 'ph/cactus', 'ph/cake', 'ph/calculator', 'ph/campfire',
  'ph/car', 'ph/carrot', 'ph/castle-turret', 'ph/cat', 'ph/cauldron',
  'ph/champagne', 'ph/church', 'ph/circle-wavy-check', 'ph/city', 'ph/coin',
  'ph/compass', 'ph/confetti', 'ph/cookie', 'ph/cooking-pot', 'ph/copyright',
  'ph/couch', 'ph/cow', 'ph/crane', 'ph/crown-simple', 'ph/cube',
  'ph/cursor-click', 'ph/cylinder', 'ph/detective', 'ph/diamond', 'ph/disc',
  'ph/dog', 'ph/door', 'ph/dress', 'ph/drone', 'ph/drop',
  'ph/ear', 'ph/egg', 'ph/engine', 'ph/escalator-up', 'ph/exam',
  'ph/eye', 'ph/eyedropper', 'ph/factory', 'ph/farm', 'ph/feather',
  'ph/fire', 'ph/fire-extinguisher', 'ph/fish', 'ph/flag-banner', 'ph/flame',
  'ph/flashlight', 'ph/flask', 'ph/flower-lotus', 'ph/flying-saucer', 'ph/football',
  'ph/fork-knife', 'ph/fortress', 'ph/fuel-pump', 'ph/game-controller', 'ph/garage',
  'ph/gas-pump', 'ph/gauge', 'ph/ghost', 'ph/gift', 'ph/globe-hemisphere-west',

  // ── Carbon Icons (carbon) ──
  'carbon/3d-cursor', 'carbon/accessibility', 'carbon/account', 'carbon/activity', 'carbon/analytics',
  'carbon/api', 'carbon/application', 'carbon/archive', 'carbon/area', 'carbon/asset',
  'carbon/attachment', 'carbon/badge', 'carbon/basketball', 'carbon/battery-full', 'carbon/bee',
  'carbon/bicycle', 'carbon/binoculars', 'carbon/blockchain', 'carbon/blog', 'carbon/bluetooth',
  'carbon/book', 'carbon/bot', 'carbon/brightness-contrast', 'carbon/building', 'carbon/bullhorn',
  'carbon/bus', 'carbon/cafe', 'carbon/calculator', 'carbon/calendar', 'carbon/camera',
  'carbon/car', 'carbon/carbon-accounting', 'carbon/catalog', 'carbon/categories', 'carbon/certificate',
  'carbon/champion', 'carbon/chart-cluster-bar', 'carbon/chart-radar', 'carbon/chart-ring', 'carbon/chart-rose',
  'carbon/chat', 'carbon/chemistry', 'carbon/chip', 'carbon/choices', 'carbon/clean',
  'carbon/cloud-satellite', 'carbon/code', 'carbon/cognitive', 'carbon/collaborate', 'carbon/color-palette',
  'carbon/compass', 'carbon/concept', 'carbon/condition-point', 'carbon/construction', 'carbon/container-registry',
  'carbon/corn', 'carbon/covariate', 'carbon/credentials', 'carbon/crop-growth', 'carbon/crowd-report',
  'carbon/cube', 'carbon/currency', 'carbon/dashboard', 'carbon/data-accessor', 'carbon/data-quality',
  'carbon/decision', 'carbon/delivery-truck', 'carbon/deploy', 'carbon/dew-point', 'carbon/diamond',
  'carbon/direction-bear-right', 'carbon/dog-walker', 'carbon/drone', 'carbon/earth', 'carbon/earthquake',

  // ── Lucide Icons ──
  'lucide/anchor', 'lucide/aperture', 'lucide/apple', 'lucide/atom', 'lucide/award',
  'lucide/axe', 'lucide/baby', 'lucide/backpack', 'lucide/badge-check', 'lucide/banana',
  'lucide/bath', 'lucide/battery', 'lucide/beaker', 'lucide/bean', 'lucide/bed',
  'lucide/beer', 'lucide/bell-dot', 'lucide/bike', 'lucide/binoculars', 'lucide/bird',
  'lucide/blend', 'lucide/blocks', 'lucide/bone', 'lucide/book-open', 'lucide/bot',
  'lucide/box', 'lucide/brain', 'lucide/brick-wall', 'lucide/briefcase', 'lucide/brush',
  'lucide/bug', 'lucide/building', 'lucide/bus', 'lucide/cable', 'lucide/cake',
  'lucide/calculator', 'lucide/calendar-heart', 'lucide/camera', 'lucide/candy', 'lucide/car',
  'lucide/carrot', 'lucide/castle', 'lucide/cat', 'lucide/cherry', 'lucide/church',
  'lucide/citrus', 'lucide/cloud-lightning', 'lucide/clover', 'lucide/club', 'lucide/coffee',
  'lucide/cog', 'lucide/compass', 'lucide/cone', 'lucide/construction', 'lucide/cookie',
  'lucide/cooking-pot', 'lucide/cpu', 'lucide/creative-commons', 'lucide/croissant', 'lucide/crown',
  'lucide/cup-soda', 'lucide/cylinder', 'lucide/diamond', 'lucide/dice-1', 'lucide/disc-3',
  'lucide/dog', 'lucide/door-open', 'lucide/drama', 'lucide/drill', 'lucide/droplet',
  'lucide/drum', 'lucide/dumbbell', 'lucide/ear', 'lucide/egg', 'lucide/factory',
  'lucide/feather', 'lucide/fence', 'lucide/ferris-wheel', 'lucide/fingerprint', 'lucide/fire-extinguisher',
  'lucide/fish', 'lucide/flag', 'lucide/flame', 'lucide/flashlight', 'lucide/flask-conical',
  'lucide/flower', 'lucide/footprints', 'lucide/forklift', 'lucide/fuel', 'lucide/gallery-vertical',

  // ── Game Icons (game-icons) ── ultra-unique shapes
  'game-icons/3d-stairs', 'game-icons/abstract-001', 'game-icons/acorn', 'game-icons/aegis',
  'game-icons/alien-fire', 'game-icons/ammonite', 'game-icons/anchor', 'game-icons/angel-wings',
  'game-icons/ant', 'game-icons/anvil', 'game-icons/aquarius', 'game-icons/archery-target',
  'game-icons/atomic-slashes', 'game-icons/aurora', 'game-icons/axe-swing', 'game-icons/baobab',
  'game-icons/barbed-coil', 'game-icons/bat-wing', 'game-icons/bear-head', 'game-icons/bee',
  'game-icons/big-diamond-ring', 'game-icons/bird-claw', 'game-icons/black-cat', 'game-icons/black-hole-bolas',
  'game-icons/blade-bite', 'game-icons/bolt-spell-cast', 'game-icons/bonsai-tree', 'game-icons/boomerang',
  'game-icons/brain', 'game-icons/broken-heart', 'game-icons/bubbles', 'game-icons/bull',
  'game-icons/burning-meteor', 'game-icons/butterfly', 'game-icons/caged-ball', 'game-icons/candle-flame',
  'game-icons/cauldron', 'game-icons/centaur', 'game-icons/chain-lightning', 'game-icons/chess-king',
  'game-icons/circular-saw', 'game-icons/claw-hammer', 'game-icons/clockwork', 'game-icons/cloud-ring',
  'game-icons/cobra', 'game-icons/cog', 'game-icons/companion-cube', 'game-icons/converge-target',
  'game-icons/coral', 'game-icons/cornucopia', 'game-icons/crescent-blade', 'game-icons/crystal-growth',
  'game-icons/cubes', 'game-icons/cyclopse-eye', 'game-icons/daemon-skull', 'game-icons/death-star',
  'game-icons/deer', 'game-icons/desert-skull', 'game-icons/dna1', 'game-icons/dolphin',
  'game-icons/dragon', 'game-icons/dreamcatcher', 'game-icons/drop', 'game-icons/eagle-emblem',
  'game-icons/earth-africa-europe', 'game-icons/eclipse', 'game-icons/elf-ear', 'game-icons/emerald',
  'game-icons/evil-eyes', 'game-icons/explosion', 'game-icons/eye-of-horus', 'game-icons/eyeball',
  'game-icons/fairy-wand', 'game-icons/falcon-moon', 'game-icons/falling-star', 'game-icons/fire-ring',
  'game-icons/flame-claws', 'game-icons/flying-fox', 'game-icons/forest', 'game-icons/fox-head',
  'game-icons/frozen-orb', 'game-icons/galaxy', 'game-icons/gear-hammer', 'game-icons/gem-chain',
  'game-icons/ghost', 'game-icons/ginkgo-leaf', 'game-icons/globe', 'game-icons/gorilla',
  'game-icons/grapple', 'game-icons/griffin-shield', 'game-icons/hawk-emblem', 'game-icons/health-potion',
  'game-icons/heart-tower', 'game-icons/hexagonal-nut', 'game-icons/honeycomb', 'game-icons/hourglass',
  'game-icons/hydra', 'game-icons/ice-bolt', 'game-icons/incense', 'game-icons/jelly-beans',
  'game-icons/jetpack', 'game-icons/key', 'game-icons/kite', 'game-icons/kraken-tentacle',
  'game-icons/laserburn', 'game-icons/leaf-swirl', 'game-icons/lighthouse', 'game-icons/lion',
  'game-icons/lotus', 'game-icons/lunar-module', 'game-icons/magic-lamp', 'game-icons/magnet',
  'game-icons/maple-leaf', 'game-icons/mermaid', 'game-icons/meteor-impact', 'game-icons/microscope',
  'game-icons/mine-wagon', 'game-icons/mirror-mirror', 'game-icons/moebius-star', 'game-icons/moon-orbit',
  'game-icons/mountain-road', 'game-icons/mushroom', 'game-icons/musical-notes', 'game-icons/nested-hexagons',
  'game-icons/nuclear', 'game-icons/oak', 'game-icons/octopus', 'game-icons/omega',
  'game-icons/orion', 'game-icons/owl', 'game-icons/palm-tree', 'game-icons/paper-crane',
  'game-icons/parachute', 'game-icons/paw', 'game-icons/peace-dove', 'game-icons/pegasus',
  'game-icons/pentagram-rose', 'game-icons/phoenix', 'game-icons/pie-slice', 'game-icons/pine-tree',
  'game-icons/planet-core', 'game-icons/poison-bottle', 'game-icons/prism', 'game-icons/pumpkin',
  'game-icons/puzzle', 'game-icons/radar-dish', 'game-icons/rainbow-star', 'game-icons/raven',
  'game-icons/razor', 'game-icons/robot-golem', 'game-icons/rocket', 'game-icons/rose',
  'game-icons/rune-stone', 'game-icons/sand-castle', 'game-icons/saturn', 'game-icons/scales',
  'game-icons/scarab', 'game-icons/scroll-unfurled', 'game-icons/sea-dragon', 'game-icons/seahorse',
  'game-icons/shield-bounces', 'game-icons/shining-heart', 'game-icons/ship-wheel', 'game-icons/skull-crossbones',
  'game-icons/snail', 'game-icons/snake', 'game-icons/snowflake-1', 'game-icons/solar-system',
  'game-icons/spark-spirit', 'game-icons/spectrum', 'game-icons/spider-web', 'game-icons/spiral-bloom',
  'game-icons/star-swirl', 'game-icons/stone-bridge', 'game-icons/submarine', 'game-icons/sun',
  'game-icons/sunflower', 'game-icons/swords-emblem', 'game-icons/telescope', 'game-icons/temple-gate',
  'game-icons/tentacles-skull', 'game-icons/three-keys', 'game-icons/thunderball', 'game-icons/tornado',
  'game-icons/trident', 'game-icons/triforce', 'game-icons/trophy', 'game-icons/turtle',
  'game-icons/two-coins', 'game-icons/unicorn', 'game-icons/viking-helmet', 'game-icons/vine-whip',
  'game-icons/volcano', 'game-icons/vortex', 'game-icons/wasp-sting', 'game-icons/water-drop',
  'game-icons/web-spit', 'game-icons/whale-tail', 'game-icons/windmill', 'game-icons/wolf-head',
  'game-icons/world-tree', 'game-icons/yin-yang', 'game-icons/zebra',
];

/**
 * Returns an Iconify SVG icon URL for any node type.
 * Uses the explicit map first (~250 types), then falls back to a deterministic
 * hash that picks from a pool of 500+ icons across 6 collections.
 */
function getNodeIcon(nodeType: string): string {
  if (NODE_ICONS[nodeType]) return NODE_ICONS[nodeType];
  // Deterministic hash → pick from fallback pool
  let hash = 0;
  for (let i = 0; i < nodeType.length; i++) {
    hash = nodeType.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash) % FALLBACK_ICONS.length;
  const [collection, icon] = FALLBACK_ICONS[idx].split('/');
  return `https://api.iconify.design/${collection}/${icon}.svg`;
}

// Créer le programme de rendu des pictogrammes
const NodePictogramProgram = createNodeImageProgram({
  padding: 0.15,
  size: { mode: 'force', value: 256 },
  drawingMode: 'color',
  colorAttribute: 'pictoColor',
});

const NodeProgram = createNodeCompoundProgram([NodeCircleProgram, NodePictogramProgram]);

// Calcul adaptatif des tailles selon le nombre de nœuds
function getAdaptiveSizes(nodeCount: number) {
  if (nodeCount > 10000) {
    return { nodeSize: 2, edgeSize: 0.3, hoverSize: 6, edgeColor: 'rgba(100,100,100,0.15)' };
  } else if (nodeCount > 5000) {
    return { nodeSize: 3, edgeSize: 0.5, hoverSize: 8, edgeColor: 'rgba(100,100,100,0.25)' };
  } else if (nodeCount > 1000) {
    return { nodeSize: 5, edgeSize: 1, hoverSize: 10, edgeColor: '#555' };
  }
  return { nodeSize: 10, edgeSize: 2, hoverSize: 15, edgeColor: '#666' };
}

// Adaptive presets based on graph size (for parameter panel defaults)
function getDefaultSigmaParams(nodeCount: number) {
  if (nodeCount > 10000) {
    return {
      nodeSize: 2, hoverSize: 6, edgeSize: 0.3, edgeOpacity: 0.15,
      labelSize: 10, labelThreshold: 20, showLabels: false, showArrows: false, showIcons: false,
      gravity: 0.05, scalingRatio: 50, slowDown: 10, iterations: 20,
      barnesHut: true, strongGravity: false,
    };
  }
  if (nodeCount > 5000) {
    return {
      nodeSize: 3, hoverSize: 8, edgeSize: 0.5, edgeOpacity: 0.25,
      labelSize: 10, labelThreshold: 15, showLabels: false, showArrows: false, showIcons: false,
      gravity: 0.3, scalingRatio: 10, slowDown: 3, iterations: 15,
      barnesHut: true, strongGravity: false,
    };
  }
  if (nodeCount > 1000) {
    return {
      nodeSize: 5, hoverSize: 10, edgeSize: 1, edgeOpacity: 0.5,
      labelSize: 10, labelThreshold: 8, showLabels: true, showArrows: true, showIcons: true,
      gravity: 0.5, scalingRatio: 5, slowDown: 2, iterations: 30,
      barnesHut: true, strongGravity: false,
    };
  }
  if (nodeCount > 200) {
    return {
      nodeSize: 8, hoverSize: 13, edgeSize: 1.5, edgeOpacity: 0.6,
      labelSize: 12, labelThreshold: 8, showLabels: true, showArrows: true, showIcons: true,
      gravity: 1, scalingRatio: 10, slowDown: 1, iterations: 50,
      barnesHut: false, strongGravity: false,
    };
  }
  return {
    nodeSize: 10, hoverSize: 15, edgeSize: 2, edgeOpacity: 0.7,
    labelSize: 12, labelThreshold: 6, showLabels: true, showArrows: true, showIcons: true,
    gravity: 1, scalingRatio: 10, slowDown: 1, iterations: 50,
    barnesHut: false, strongGravity: false,
  };
}

interface LevelTiming {
  depth: number;
  nodesAdded: number;
  totalNodes: number;
  timeMs: number;
  layoutMs: number;
  cached: boolean;
}

interface BenchmarkResult {
  depth: number;
  nodesAdded: number;
  totalNodes: number;
  cachedMs: number;
  cachedLayoutMs: number;
  rawMs: number;
  rawLayoutMs: number;
}

const SigmaGraphViewer: React.FC<SigmaGraphViewerProps> = ({ data, graphId }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [renderTime, setRenderTime] = useState<number | null>(null);
  const [timingDetails, setTimingDetails] = useState<{
    graphBuild: number; layout: number; sigmaInit: number; events: number; webglRender: number;
  } | null>(null);
  const [timingOpen, setTimingOpen] = useState(false);
  const [nodeTypes, setNodeTypes] = useState<Array<{ type: string; color: string; count: number }>>([]);
  const [resetKey, setResetKey] = useState(0);

  // Progressive mode
  const [progressiveMode, setProgressiveMode] = useState<boolean>(false);
  const [currentDepth, setCurrentDepth] = useState<number>(0);
  const [visibleNodes, setVisibleNodes] = useState<Set<string>>(new Set());
  const progressiveModeRef = useRef<boolean>(false);
  const currentDepthRef = useRef<number>(0);
  const visibleNodesRef = useRef<Set<string>>(new Set());

  useEffect(() => { progressiveModeRef.current = progressiveMode; }, [progressiveMode]);
  useEffect(() => { currentDepthRef.current = currentDepth; }, [currentDepth]);
  useEffect(() => { visibleNodesRef.current = visibleNodes; }, [visibleNodes]);

  // ─── Cache performance comparison ───
  const [useCache, setUseCache] = useState(true);
  const useCacheRef = useRef(true);
  useEffect(() => { useCacheRef.current = useCache; }, [useCache]);
  const [levelTimings, setLevelTimings] = useState<LevelTiming[]>([]);
  const [benchmarkResult, setBenchmarkResult] = useState<BenchmarkResult | null>(null);

  // ─── Parameter panel ───
  const [panelOpen, setPanelOpen] = useState(true);
  const nc = data?.nodes?.length || 0;
  const defaults = getDefaultSigmaParams(nc);

  const [nodeSize, setNodeSize] = useState(defaults.nodeSize);
  const [hoverSize, setHoverSize] = useState(defaults.hoverSize);
  const [edgeSize, setEdgeSize] = useState(defaults.edgeSize);
  const [edgeOpacity, setEdgeOpacity] = useState(defaults.edgeOpacity);
  const [labelSize, setLabelSize] = useState(defaults.labelSize);
  const [labelThreshold, setLabelThreshold] = useState(defaults.labelThreshold);
  const [showLabels, setShowLabels] = useState(defaults.showLabels);
  const [showArrows, setShowArrows] = useState(defaults.showArrows);
  const [showIcons, setShowIcons] = useState(defaults.showIcons);
  const [gravity, setGravity] = useState(defaults.gravity);
  const [scalingRatio, setScalingRatio] = useState(defaults.scalingRatio);
  const [slowDown, setSlowDown] = useState(defaults.slowDown);
  const [iterations, setIterations] = useState(defaults.iterations);
  const [barnesHut, setBarnesHut] = useState(defaults.barnesHut);
  const [strongGravity, setStrongGravity] = useState(defaults.strongGravity);

  // Ref for hover/loadNextLevel to read up-to-date render params
  const renderParamsRef = useRef({ nodeSize, hoverSize, edgeSize, edgeOpacity, showArrows });
  useEffect(() => {
    renderParamsRef.current = { nodeSize, hoverSize, edgeSize, edgeOpacity, showArrows };
  }, [nodeSize, hoverSize, edgeSize, edgeOpacity, showArrows]);

  // Reset params when graph changes
  useEffect(() => {
    const d = getDefaultSigmaParams(data?.nodes?.length || 0);
    setNodeSize(d.nodeSize); setHoverSize(d.hoverSize);
    setEdgeSize(d.edgeSize); setEdgeOpacity(d.edgeOpacity);
    setLabelSize(d.labelSize); setLabelThreshold(d.labelThreshold);
    setShowLabels(d.showLabels); setShowArrows(d.showArrows); setShowIcons(d.showIcons);
    setGravity(d.gravity); setScalingRatio(d.scalingRatio);
    setSlowDown(d.slowDown); setIterations(d.iterations);
    setBarnesHut(d.barnesHut); setStrongGravity(d.strongGravity);
  }, [data, graphId]);

  // ─── Pre-computed indexes ───
  const nodeIndex = useMemo(() => {
    const map = new Map<string, GraphNode>();
    if (data) data.nodes.forEach(n => map.set(n.id, n));
    return map;
  }, [data]);

  const adjacency = useMemo(() => {
    const adj = new Map<string, Set<string>>();
    if (data) {
      data.edges.forEach((edge) => {
        if (!adj.has(edge.source)) adj.set(edge.source, new Set());
        if (!adj.has(edge.target)) adj.set(edge.target, new Set());
        adj.get(edge.source)!.add(edge.target);
        adj.get(edge.target)!.add(edge.source);
      });
    }
    return adj;
  }, [data]);

  // ─── Progressive: load next level ───
  const loadNextLevel = useCallback(() => {
    if (!graphRef.current || !data || data.nodes.length === 0) return;

    const levelStart = performance.now();
    const withCache = useCacheRef.current;
    const graph = graphRef.current;
    const p = renderParamsRef.current;

    const currentNodes = new Set<string>();
    graph.forEachNode((nodeId) => currentNodes.add(nodeId));

    if (currentNodes.size >= data.nodes.length || currentNodes.size === 0) return;

    const newNodeIds = new Set<string>();
    for (const nodeId of currentNodes) {
      const neighbors = adjacency.get(nodeId);
      if (neighbors) {
        for (const neighbor of neighbors) {
          if (!currentNodes.has(neighbor)) newNodeIds.add(neighbor);
        }
      }
    }

    if (newNodeIds.size === 0) {
      const SEEDS_PER_JUMP = Math.max(1, Math.floor(currentNodes.size * 0.1));
      let seedCount = 0;
      for (const node of data.nodes) {
        if (!currentNodes.has(node.id)) {
          newNodeIds.add(node.id);
          seedCount++;
          const seedNeighbors = adjacency.get(node.id);
          if (seedNeighbors) {
            for (const neighbor of seedNeighbors) {
              if (!currentNodes.has(neighbor)) newNodeIds.add(neighbor);
            }
          }
          if (seedCount >= SEEDS_PER_JUMP) break;
        }
      }
    }

    const typeMap = new Map<string, { color: string; count: number }>();
    nodeTypes.forEach(({ type, color, count }) => typeMap.set(type, { color, count }));

    const cachedPositions = (withCache && graphId) ? nodePositionCache.getGraphPositions(graphId) : {};
    const edgeColorStr = `rgba(100,100,100,${p.edgeOpacity})`;

    for (const nId of newNodeIds) {
      const nodeData = nodeIndex.get(nId);
      if (!nodeData) continue;
      const nodeType = nodeData.node_type || 'default';
      const color = NODE_COLORS[nodeType] || generateColorFromString(nodeType);
      const existing = typeMap.get(nodeType);
      if (existing) existing.count++;
      else typeMap.set(nodeType, { color, count: 1 });
      const cachedPos = cachedPositions[nId];
      graph.addNode(nId, {
        label: nodeData.label || nId,
        size: p.nodeSize,
        color,
        x: cachedPos?.x ?? Math.random() * 500,
        y: cachedPos?.y ?? Math.random() * 500,
        type: 'pictogram',
        nodeType,
        image: getNodeIcon(nodeType),
        pictoColor: '#fff',
      });
    }

    const allVisible = new Set([...currentNodes, ...newNodeIds]);
    const existingEdges = new Set<string>();
    graph.forEachEdge((_edge, _attrs, source, target) => existingEdges.add(`${source}->${target}`));

    data.edges.forEach((edge) => {
      if (allVisible.has(edge.source) && allVisible.has(edge.target)) {
        const key = `${edge.source}->${edge.target}`;
        if (!existingEdges.has(key)) {
          existingEdges.add(key);
          try {
            graph.addEdge(edge.source, edge.target, {
              size: p.edgeSize,
              color: edgeColorStr,
              type: p.showArrows ? 'arrow' : 'line',
            });
          } catch (e) { /* skip duplicate */ }
        }
      }
    });

    for (const nodeId of currentNodes) {
      graph.setNodeAttribute(nodeId, 'size', p.nodeSize);
    }

    // Layout: skip ForceAtlas2 if all new nodes have cached positions
    let layoutMs = 0;
    const allNewNodesCached = withCache && newNodeIds.size > 0 &&
      [...newNodeIds].every(nId => cachedPositions[nId]);

    if (!allNewNodesCached) {
      const layoutStart = performance.now();
      try {
        const settings = forceAtlas2.inferSettings(graph);
        const count = graph.order;
        const iters = count > 10000 ? 10 : count > 5000 ? 15 : count > 1000 ? 20 : 30;
        forceAtlas2.assign(graph, {
          iterations: iters,
          settings: {
            ...settings,
            gravity: count > 5000 ? 0.3 : 1,
            scalingRatio: count > 5000 ? 10 : 5,
            barnesHutOptimize: count > 1000,
          },
        });
      } catch (error) {
        console.error('Layout error:', error);
      }
      layoutMs = performance.now() - layoutStart;
    }

    if (graphId) {
      const positions: Record<string, { x: number; y: number }> = {};
      graph.forEachNode((nodeId, attrs) => {
        positions[nodeId] = { x: attrs.x, y: attrs.y };
      });
      nodePositionCache.setGraphPositions(graphId, positions);
    }

    const totalMs = performance.now() - levelStart;
    const newDepth = currentDepthRef.current + 1;
    setLevelTimings(prev => [...prev, {
      depth: newDepth,
      nodesAdded: newNodeIds.size,
      totalNodes: allVisible.size,
      timeMs: totalMs,
      layoutMs,
      cached: withCache,
    }]);

    setNodeTypes(
      Array.from(typeMap.entries())
        .map(([type, { color, count }]) => ({ type, color, count }))
        .sort((a, b) => b.count - a.count)
    );
    setVisibleNodes(allVisible);
    setCurrentDepth(prev => prev + 1);
    sigmaRef.current?.refresh();
  }, [data, adjacency, nodeIndex, graphId, nodeTypes]);

  // ─── Benchmark: compare cache vs raw for next level ───
  const benchmarkNextLevel = useCallback(() => {
    if (!graphRef.current || !data || data.nodes.length === 0 || !graphId) return;

    const graph = graphRef.current;
    const p = renderParamsRef.current;

    // Discover next-level nodes (read-only, same logic as loadNextLevel)
    const currentNodes = new Set<string>();
    graph.forEachNode((nodeId) => currentNodes.add(nodeId));
    if (currentNodes.size >= data.nodes.length || currentNodes.size === 0) return;

    const newNodeIds = new Set<string>();
    for (const nodeId of currentNodes) {
      const neighbors = adjacency.get(nodeId);
      if (neighbors) {
        for (const neighbor of neighbors) {
          if (!currentNodes.has(neighbor)) newNodeIds.add(neighbor);
        }
      }
    }
    if (newNodeIds.size === 0) return;

    const allVisible = new Set([...currentNodes, ...newNodeIds]);
    const cachedPositions = nodePositionCache.getGraphPositions(graphId);
    const edgeColorStr = `rgba(100,100,100,${p.edgeOpacity})`;

    // Measure a single run: clone graph → add nodes → (optional) layout → time it
    const measure = (withCache: boolean): { timeMs: number; layoutMs: number } => {
      const tempGraph = graph.copy();
      const positions = withCache ? cachedPositions : {};
      const tStart = performance.now();

      for (const nId of newNodeIds) {
        const nd = nodeIndex.get(nId);
        if (!nd) continue;
        const pos = positions[nId];
        tempGraph.addNode(nId, {
          label: nd.label || nId, size: p.nodeSize,
          color: NODE_COLORS[nd.node_type] || generateColorFromString(nd.node_type),
          x: pos?.x ?? Math.random() * 500,
          y: pos?.y ?? Math.random() * 500,
          type: 'circle', nodeType: nd.node_type,
        });
      }

      const existingEdges = new Set<string>();
      tempGraph.forEachEdge((_e: string, _a: any, s: string, t: string) => existingEdges.add(`${s}->${t}`));
      data!.edges.forEach((edge) => {
        if (allVisible.has(edge.source) && allVisible.has(edge.target)) {
          const key = `${edge.source}->${edge.target}`;
          if (!existingEdges.has(key)) {
            existingEdges.add(key);
            try { tempGraph.addEdge(edge.source, edge.target, { size: p.edgeSize, color: edgeColorStr, type: 'line' }); } catch (error) { /* skip */ }
          }
        }
      });

      let layoutMs = 0;
      const allCached = withCache && [...newNodeIds].every(nId => positions[nId]);
      if (!allCached) {
        const lStart = performance.now();
        try {
          const settings = forceAtlas2.inferSettings(tempGraph);
          const count = tempGraph.order;
          const iters = count > 10000 ? 10 : count > 5000 ? 15 : count > 1000 ? 20 : 30;
          forceAtlas2.assign(tempGraph, {
            iterations: iters,
            settings: { ...settings, gravity: count > 5000 ? 0.3 : 1, scalingRatio: count > 5000 ? 10 : 5, barnesHutOptimize: count > 1000 },
          });
        } catch (error) { /* ignore */ }
        layoutMs = performance.now() - lStart;
      }

      return { timeMs: performance.now() - tStart, layoutMs };
    };

    const cached = measure(true);
    const raw = measure(false);

    setBenchmarkResult({
      depth: currentDepthRef.current + 1,
      nodesAdded: newNodeIds.size,
      totalNodes: allVisible.size,
      cachedMs: cached.timeMs,
      cachedLayoutMs: cached.layoutMs,
      rawMs: raw.timeMs,
      rawLayoutMs: raw.layoutMs,
    });
  }, [data, adjacency, nodeIndex, graphId]);

  // ─── Progressive: reset ───
  const resetToStart = useCallback(() => {
    if (!data || data.nodes.length === 0) return;
    setCurrentDepth(0);
    setVisibleNodes(new Set());
    setNodeTypes([]);
    setLevelTimings([]);
    setBenchmarkResult(null);
    // Increment resetKey to trigger full rebuild of graph + Sigma
    setResetKey(k => k + 1);
  }, [data]);

  // ─── Main useEffect: build graph + Sigma instance ───
  useEffect(() => {
    if (!containerRef.current || !data) return;
    const startTime = performance.now();
    setRenderTime(null);

    if (sigmaRef.current) {
      sigmaRef.current.kill();
      sigmaRef.current = null;
    }

    const graph = new Graph();
    graphRef.current = graph;

    const typeMap = new Map<string, { color: string; count: number }>();
    const cachedPositions = graphId ? nodePositionCache.getGraphPositions(graphId) : {};
    const p = renderParamsRef.current;
    const tBuildStart = performance.now();
    let tLayoutStart = tBuildStart;
    let tLayoutEnd = tBuildStart;

    if (progressiveMode) {
      const firstNode = data.nodes[0];
      if (firstNode) {
        const nodeType = firstNode.node_type || 'default';
        const color = NODE_COLORS[nodeType] || generateColorFromString(nodeType);
        typeMap.set(nodeType, { color, count: 1 });
        const cachedPos = cachedPositions[firstNode.id];
        graph.addNode(firstNode.id, {
          label: firstNode.label || firstNode.id,
          size: p.nodeSize,
          color,
          x: cachedPos?.x ?? 50,
          y: cachedPos?.y ?? 50,
          type: 'pictogram',
          nodeType,
          image: getNodeIcon(nodeType),
          pictoColor: '#fff',
        });
        setVisibleNodes(new Set([firstNode.id]));
        setCurrentDepth(0);
      }
    } else {
      const edgeColorStr = `rgba(100,100,100,${p.edgeOpacity})`;

      data.nodes.forEach((node) => {
        const nodeType = node.node_type || 'default';
        const color = NODE_COLORS[nodeType] || generateColorFromString(nodeType);
        const existing = typeMap.get(nodeType);
        if (existing) existing.count++;
        else typeMap.set(nodeType, { color, count: 1 });
        const cachedPos = cachedPositions[node.id];
        graph.addNode(node.id, {
          label: node.label || node.id,
          size: p.nodeSize,
          color,
          x: cachedPos?.x ?? Math.random() * 500,
          y: cachedPos?.y ?? Math.random() * 500,
          type: 'pictogram',
          nodeType,
          image: getNodeIcon(nodeType),
          pictoColor: '#fff',
        });
      });

      const edgeSet = new Set<string>();
      data.edges.forEach((edge) => {
        const edgeKey = `${edge.source}->${edge.target}`;
        if (edgeSet.has(edgeKey)) return;
        edgeSet.add(edgeKey);
        try {
          graph.addEdge(edge.source, edge.target, {
            size: p.edgeSize,
            color: edgeColorStr,
            type: p.showArrows ? 'arrow' : 'line',
          });
        } catch (error) {
          // skip invalid edge
        }
      });

      // ForceAtlas2 – only when no cached positions
      const hasCachedPositions = Object.keys(cachedPositions).length > 0;
      tLayoutStart = performance.now();
      if (!hasCachedPositions) {
        try {
          const inferredSettings = forceAtlas2.inferSettings(graph);
          forceAtlas2.assign(graph, {
            iterations,
            settings: {
              ...inferredSettings,
              gravity,
              scalingRatio,
              slowDown,
              barnesHutOptimize: barnesHut,
              strongGravityMode: strongGravity,
            },
          });
        } catch (error) {
          console.error('ForceAtlas2 error:', error);
        }

        if (graphId) {
          const positions: Record<string, { x: number; y: number }> = {};
          graph.forEachNode((nodeId, attrs) => {
            positions[nodeId] = { x: attrs.x, y: attrs.y };
          });
          nodePositionCache.setGraphPositions(graphId, positions);
        }
      }
    }

    tLayoutEnd = performance.now();

    // Legend
    setNodeTypes(
      Array.from(typeMap.entries())
        .map(([type, { color, count }]) => ({ type, color, count }))
        .sort((a, b) => b.count - a.count)
    );

    // Create Sigma instance
    const effectiveNodeCount = progressiveMode ? 1 : data.nodes.length;
    const sigma = new Sigma(graph, containerRef.current, {
      renderEdgeLabels: false,
      renderLabels: p.nodeSize >= 3, // initial; live-updated via setSetting
      defaultNodeColor: NODE_COLORS.default,
      defaultEdgeColor: `rgba(100,100,100,${p.edgeOpacity})`,
      defaultNodeType: showIcons ? 'pictogram' : 'circle',
      nodeProgramClasses: { pictogram: NodeProgram, circle: NodeCircleProgram },
      labelSize: p.nodeSize >= 3 ? 12 : 10,
      labelWeight: '600',
      labelColor: { color: '#fff' },
      labelRenderedSizeThreshold: effectiveNodeCount > 5000 ? 20 : 8,
      enableEdgeEvents: effectiveNodeCount < 2000,
      allowInvalidContainer: true,
      zIndex: true,
      minCameraRatio: 0.01,
      maxCameraRatio: 20,
    });

    sigmaRef.current = sigma;

    const tSigmaEnd = performance.now();

    // WebGL context recovery
    const canvas = containerRef.current.querySelector('canvas');
    if (canvas) {
      canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        console.warn('WebGL context lost');
      });
      canvas.addEventListener('webglcontextrestored', () => {
        sigma.refresh();
      });
    }

    // ─── Hover handlers (read from refs for up-to-date sizes) ───
    sigma.on('enterNode', ({ node }) => {
      setHoveredNode(node);
      const rp = renderParamsRef.current;
      const neighbors = new Set(graph.neighbors(node));
      neighbors.add(node);

      graph.forEachNode((n) => {
        if (neighbors.has(n)) {
          graph.setNodeAttribute(n, 'highlighted', true);
          graph.setNodeAttribute(n, 'size', rp.hoverSize);
        } else {
          graph.setNodeAttribute(n, 'color', 'rgba(50,50,50,0.15)');
          graph.setNodeAttribute(n, 'highlighted', false);
        }
      });

      graph.forEachEdge((edge, _attrs, source, target) => {
        if (source === node || target === node) {
          graph.setEdgeAttribute(edge, 'color', '#fff');
          graph.setEdgeAttribute(edge, 'size', Math.max(rp.edgeSize * 3, 1.5));
        } else {
          graph.setEdgeAttribute(edge, 'color', 'rgba(50,50,50,0.05)');
        }
      });

      sigma.refresh();
    });

    sigma.on('leaveNode', () => {
      setHoveredNode(null);
      const rp = renderParamsRef.current;
      const edgeColorStr = `rgba(100,100,100,${rp.edgeOpacity})`;

      graph.forEachNode((node) => {
        const attributes = graph.getNodeAttributes(node);
        const nodeType = attributes.nodeType || 'default';
        const originalColor = NODE_COLORS[nodeType] || NODE_COLORS.default;
        graph.setNodeAttribute(node, 'color', originalColor);
        graph.setNodeAttribute(node, 'size', rp.nodeSize);
        graph.setNodeAttribute(node, 'highlighted', false);
      });

      graph.forEachEdge((edge) => {
        graph.setEdgeAttribute(edge, 'color', edgeColorStr);
        graph.setEdgeAttribute(edge, 'size', rp.edgeSize);
      });

      sigma.refresh();
    });

    // Measure synchronous setup time (without actual WebGL render)
    const syncEnd = performance.now();
    const syncTimingDetails = {
      graphBuild: tLayoutStart - tBuildStart,
      layout: tLayoutEnd - tLayoutStart,
      sigmaInit: tSigmaEnd - tLayoutEnd,
      events: syncEnd - tSigmaEnd,
      webglRender: 0,
    };

    // Wait for Sigma's first actual WebGL render to measure real display time
    const onFirstRender = () => {
      const totalTime = performance.now() - startTime;
      syncTimingDetails.webglRender = totalTime - (syncEnd - startTime);
      setRenderTime(totalTime);
      setTimingDetails({ ...syncTimingDetails });
      sigma.off('afterRender', onFirstRender);
    };
    sigma.on('afterRender', onFirstRender);

    // Fallback: if afterRender doesn't fire within 10s, show sync time
    const fallbackTimer = setTimeout(() => {
      sigma.off('afterRender', onFirstRender);
      if (renderTime === null) {
        setRenderTime(syncEnd - startTime);
        setTimingDetails(syncTimingDetails);
      }
    }, 10_000);

    return () => {
      clearTimeout(fallbackTimer);
      sigma.off('afterRender', onFirstRender);
      if (sigmaRef.current) {
        sigmaRef.current.kill();
        sigmaRef.current = null;
      }
    };
  }, [data, graphId, progressiveMode, resetKey]);

  // ─── Live parameter updates (no rebuild) ───
  useEffect(() => {
    if (!sigmaRef.current || !graphRef.current) return;
    const graph = graphRef.current;
    const sigma = sigmaRef.current;
    const edgeColorStr = `rgba(100,100,100,${edgeOpacity})`;

    graph.forEachNode((n) => {
      graph.setNodeAttribute(n, 'size', nodeSize);
      const nodeType = graph.getNodeAttribute(n, 'nodeType') || 'default';
      if (showIcons) {
        graph.setNodeAttribute(n, 'type', 'pictogram');
        graph.setNodeAttribute(n, 'image', getNodeIcon(nodeType));
      } else {
        graph.setNodeAttribute(n, 'type', 'circle');
        graph.setNodeAttribute(n, 'image', undefined);
      }
    });
    graph.forEachEdge((e) => {
      graph.setEdgeAttribute(e, 'size', edgeSize);
      graph.setEdgeAttribute(e, 'color', edgeColorStr);
      graph.setEdgeAttribute(e, 'type', showArrows ? 'arrow' : 'line');
    });

    sigma.setSetting('defaultNodeType', showIcons ? 'pictogram' : 'circle');
    sigma.setSetting('renderLabels', showLabels);
    sigma.setSetting('labelSize', labelSize);
    sigma.setSetting('labelRenderedSizeThreshold', labelThreshold);
    sigma.refresh();
  }, [nodeSize, edgeSize, edgeOpacity, showLabels, showArrows, showIcons, labelSize, labelThreshold]);

  // ─── Re-layout with current ForceAtlas2 params ───
  const reLayout = useCallback(() => {
    if (!graphRef.current) return;
    const graph = graphRef.current;
    try {
      const inferredSettings = forceAtlas2.inferSettings(graph);
      forceAtlas2.assign(graph, {
        iterations,
        settings: {
          ...inferredSettings,
          gravity,
          scalingRatio,
          slowDown,
          barnesHutOptimize: barnesHut,
          strongGravityMode: strongGravity,
        },
      });
    } catch (error) {
      console.error('Layout error:', error);
    }
    if (graphId) {
      const positions: Record<string, { x: number; y: number }> = {};
      graphRef.current.forEachNode((nodeId, attrs) => {
        positions[nodeId] = { x: attrs.x, y: attrs.y };
      });
      nodePositionCache.setGraphPositions(graphId, positions);
    }
    sigmaRef.current?.refresh();
  }, [gravity, scalingRatio, slowDown, iterations, barnesHut, strongGravity, graphId]);

  const resetParams = () => {
    const d = getDefaultSigmaParams(data?.nodes?.length || 0);
    setNodeSize(d.nodeSize); setHoverSize(d.hoverSize);
    setEdgeSize(d.edgeSize); setEdgeOpacity(d.edgeOpacity);
    setLabelSize(d.labelSize); setLabelThreshold(d.labelThreshold);
    setShowLabels(d.showLabels); setShowArrows(d.showArrows); setShowIcons(d.showIcons);
    setGravity(d.gravity); setScalingRatio(d.scalingRatio);
    setSlowDown(d.slowDown); setIterations(d.iterations);
    setBarnesHut(d.barnesHut); setStrongGravity(d.strongGravity);
  };

  const handleFitView = () => {
    sigmaRef.current?.getCamera().animatedReset({ duration: 600 });
  };
  const handleZoomIn = () => {
    sigmaRef.current?.getCamera().animatedZoom({ duration: 300 });
  };
  const handleZoomOut = () => {
    sigmaRef.current?.getCamera().animatedUnzoom({ duration: 300 });
  };

  if (!data) {
    return (
      <div className="sigma-graph-viewer">
        <div className="empty-state">
          <i className="bi bi-diagram-3" style={{ fontSize: '3rem', opacity: 0.5 }}></i>
          <h3>Aucun graphe sélectionné</h3>
          <p>Sélectionnez un graphe dans la liste pour le visualiser</p>
        </div>
      </div>
    );
  }

  return (
    <div className="sigma-graph-viewer">
      {/* Top-right buttons */}
      <div className="sigma-controls">
        <button onClick={handleFitView} title="Ajuster la vue">
          <i className="bi bi-arrows-fullscreen"></i> Fit
        </button>
        <button onClick={handleZoomIn} title="Zoom avant">
          <i className="bi bi-zoom-in"></i>
        </button>
        <button onClick={handleZoomOut} title="Zoom arrière">
          <i className="bi bi-zoom-out"></i>
        </button>
        <button
          onClick={() => setProgressiveMode(!progressiveMode)}
          title={progressiveMode ? 'Mode normal' : 'Mode par niveaux'}
          style={{
            backgroundColor: progressiveMode ? '#4CAF50' : '#666',
            color: '#fff',
            fontWeight: progressiveMode ? 'bold' : 'normal',
          }}
        >
          <i className={progressiveMode ? 'bi bi-layers-fill' : 'bi bi-layers'}></i>
          {' '}{progressiveMode ? 'Par niveaux' : 'Normal'}
        </button>
        {progressiveMode && graphId && (
          <>
            <button
              onClick={loadNextLevel}
              title={`Charger +1 niveau ${useCache ? '(cache)' : '(sans cache)'}`}
              style={{ backgroundColor: '#2196F3' }}
            >
              <i className="bi bi-plus-circle"></i> +1 {useCache ? '(Cache)' : '(Raw)'}
            </button>
            <button
              onClick={benchmarkNextLevel}
              title="Comparer cache vs raw pour le niveau suivant"
              style={{ backgroundColor: '#9C27B0' }}
            >
              <i className="bi bi-speedometer2"></i> ⚡ Benchmark
            </button>
            <button
              onClick={() => setUseCache(!useCache)}
              title={useCache ? 'Désactiver le cache' : 'Activer le cache'}
              style={{
                backgroundColor: useCache ? '#4CAF50' : '#666',
                minWidth: 80,
              }}
            >
              <i className={useCache ? 'bi bi-database-fill-check' : 'bi bi-database-slash'}></i>
              {' '}{useCache ? 'Cache ON' : 'Cache OFF'}
            </button>
            <button
              onClick={resetToStart}
              title="Revenir au départ"
              style={{ backgroundColor: '#FF5722' }}
            >
              <i className="bi bi-arrow-counterclockwise"></i> Reset
            </button>
            <button
              onClick={() => { nodePositionCache.clearGraph(graphId); setLevelTimings([]); setBenchmarkResult(null); }}
              title="Effacer le cache et les mesures"
              style={{ backgroundColor: '#ff9800' }}
            >
              <i className="bi bi-trash"></i> Cache
            </button>
          </>
        )}
      </div>

      {/* ─── Parameter panel (top-left) ─── */}
      <div className="sigma-params-panel">
        <div className="sigma-params-header" onClick={() => setPanelOpen(!panelOpen)}>
          <span className="params-title">⚙️ Parameters</span>
          <span className="params-toggle">{panelOpen ? '▼' : '▶'}</span>
        </div>

        {panelOpen && (
          <div className="sigma-params-body">
            <div className="params-actions">
              <button className="param-btn reset" onClick={resetParams}>Reset</button>
              <button className="param-btn reheat" onClick={reLayout}>🔄 Re-layout</button>
            </div>

            <div className="params-section">
              <div className="section-title">Nodes</div>
              <label className="param-row">
                <span className="param-label">Size <span className="param-value">{nodeSize}</span></span>
                <input type="range" min="1" max="20" step="0.5" value={nodeSize}
                  onChange={(e) => setNodeSize(parseFloat(e.target.value))} />
              </label>
              <label className="param-row">
                <span className="param-label">Hover size <span className="param-value">{hoverSize}</span></span>
                <input type="range" min="2" max="30" step="1" value={hoverSize}
                  onChange={(e) => setHoverSize(parseFloat(e.target.value))} />
              </label>
              <label className="param-row checkbox">
                <input type="checkbox" checked={showLabels}
                  onChange={(e) => setShowLabels(e.target.checked)} />
                <span>Show labels</span>
              </label>
              <label className="param-row checkbox">
                <input type="checkbox" checked={showIcons}
                  onChange={(e) => setShowIcons(e.target.checked)} />
                <span>Show icons</span>
              </label>
              <label className="param-row">
                <span className="param-label">Label size <span className="param-value">{labelSize}</span></span>
                <input type="range" min="6" max="20" step="1" value={labelSize}
                  onChange={(e) => setLabelSize(parseInt(e.target.value))} />
              </label>
              <label className="param-row">
                <span className="param-label">Label threshold <span className="param-value">{labelThreshold}</span></span>
                <input type="range" min="1" max="30" step="1" value={labelThreshold}
                  onChange={(e) => setLabelThreshold(parseInt(e.target.value))} />
              </label>
            </div>

            <div className="params-section">
              <div className="section-title">ForceAtlas2</div>
              <label className="param-row">
                <span className="param-label">Gravity <span className="param-value">{gravity.toFixed(2)}</span></span>
                <input type="range" min="0.01" max="5" step="0.01" value={gravity}
                  onChange={(e) => setGravity(parseFloat(e.target.value))} />
              </label>
              <label className="param-row">
                <span className="param-label">Scaling ratio <span className="param-value">{scalingRatio}</span></span>
                <input type="range" min="1" max="100" step="1" value={scalingRatio}
                  onChange={(e) => setScalingRatio(parseFloat(e.target.value))} />
              </label>
              <label className="param-row">
                <span className="param-label">Slow down <span className="param-value">{slowDown.toFixed(1)}</span></span>
                <input type="range" min="0.1" max="20" step="0.1" value={slowDown}
                  onChange={(e) => setSlowDown(parseFloat(e.target.value))} />
              </label>
              <label className="param-row">
                <span className="param-label">Iterations <span className="param-value">{iterations}</span></span>
                <input type="range" min="5" max="200" step="5" value={iterations}
                  onChange={(e) => setIterations(parseInt(e.target.value))} />
              </label>
              <label className="param-row checkbox">
                <input type="checkbox" checked={barnesHut}
                  onChange={(e) => setBarnesHut(e.target.checked)} />
                <span>Barnes-Hut optim.</span>
              </label>
              <label className="param-row checkbox">
                <input type="checkbox" checked={strongGravity}
                  onChange={(e) => setStrongGravity(e.target.checked)} />
                <span>Strong gravity</span>
              </label>
            </div>

            <div className="params-section">
              <div className="section-title">Edges</div>
              <label className="param-row">
                <span className="param-label">Size <span className="param-value">{edgeSize.toFixed(1)}</span></span>
                <input type="range" min="0.1" max="5" step="0.1" value={edgeSize}
                  onChange={(e) => setEdgeSize(parseFloat(e.target.value))} />
              </label>
              <label className="param-row">
                <span className="param-label">Opacity <span className="param-value">{edgeOpacity.toFixed(2)}</span></span>
                <input type="range" min="0.05" max="1" step="0.05" value={edgeOpacity}
                  onChange={(e) => setEdgeOpacity(parseFloat(e.target.value))} />
              </label>
              <label className="param-row checkbox">
                <input type="checkbox" checked={showArrows}
                  onChange={(e) => setShowArrows(e.target.checked)} />
                <span>Show arrows</span>
              </label>
            </div>
          </div>
        )}
      </div>

      <div ref={containerRef} className="sigma-container" />

      {progressiveMode && data && (
        <div className="sigma-progressive-info">
          <strong><i className="bi bi-diagram-3"></i> Mode par niveaux</strong>
          <p><i className="bi bi-signpost-split"></i> Profondeur : {currentDepth}</p>
          <p>
            <i className="bi bi-circle-fill" style={{ fontSize: '0.6em' }}></i>{' '}
            {visibleNodes.size.toLocaleString()} / {data.nodes.length.toLocaleString()} nœuds
            {' '}({((visibleNodes.size / data.nodes.length) * 100).toFixed(1)}%)
          </p>
          {visibleNodes.size >= data.nodes.length && (
            <p style={{ color: '#4CAF50' }}>
              <i className="bi bi-check-circle-fill"></i> Graphe entièrement visible
            </p>
          )}

          {/* Benchmark result */}
          {benchmarkResult && (
            <div className="benchmark-result">
              <strong><i className="bi bi-speedometer2"></i> Benchmark (Niveau {benchmarkResult.depth})</strong>
              <div className="benchmark-row">
                <span className="benchmark-label">🟢 Cache</span>
                <span className="benchmark-value">{benchmarkResult.cachedMs.toFixed(1)}ms</span>
                <span className="benchmark-detail">(layout: {benchmarkResult.cachedLayoutMs.toFixed(1)}ms)</span>
              </div>
              <div className="benchmark-row">
                <span className="benchmark-label">🔴 Raw</span>
                <span className="benchmark-value">{benchmarkResult.rawMs.toFixed(1)}ms</span>
                <span className="benchmark-detail">(layout: {benchmarkResult.rawLayoutMs.toFixed(1)}ms)</span>
              </div>
              <div className="benchmark-gain">
                {benchmarkResult.rawMs > benchmarkResult.cachedMs ? (
                  <>
                    <i className="bi bi-arrow-up-circle-fill" style={{ color: '#4CAF50' }}></i>{' '}
                    <span style={{ color: '#4CAF50' }}>
                      Cache <strong>{((1 - benchmarkResult.cachedMs / benchmarkResult.rawMs) * 100).toFixed(0)}%</strong> plus rapide
                    </span>
                    <br />
                    <span style={{ fontSize: '10px', opacity: 0.7 }}>
                      {benchmarkResult.nodesAdded} nœuds ajoutés • {benchmarkResult.totalNodes} total
                    </span>
                  </>
                ) : (
                  <span style={{ color: '#FF9800' }}>
                    <i className="bi bi-dash-circle"></i> Pas de gain ({benchmarkResult.nodesAdded} nœuds)
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Timing history */}
          {levelTimings.length > 0 && (
            <div className="level-timings">
              <strong><i className="bi bi-clock-history"></i> Historique</strong>
              <div className="timings-table">
                <div className="timings-header">
                  <span>Niv.</span><span>+Nœuds</span><span>Total</span><span>Layout</span><span>Mode</span>
                </div>
                {levelTimings.slice(-8).map((t, i) => (
                  <div key={i} className="timings-row">
                    <span>{t.depth}</span>
                    <span>+{t.nodesAdded}</span>
                    <span>{t.timeMs.toFixed(0)}ms</span>
                    <span>{t.layoutMs.toFixed(0)}ms</span>
                    <span className={t.cached ? 'cache-on' : 'cache-off'}>
                      {t.cached ? '🟢' : '🔴'}
                    </span>
                  </div>
                ))}
              </div>
              {(() => {
                const ce = levelTimings.filter(t => t.cached);
                const re = levelTimings.filter(t => !t.cached);
                if (ce.length > 0 && re.length > 0) {
                  const avgC = ce.reduce((s, t) => s + t.timeMs, 0) / ce.length;
                  const avgR = re.reduce((s, t) => s + t.timeMs, 0) / re.length;
                  const gain = ((1 - avgC / avgR) * 100);
                  return (
                    <div className="timings-summary">
                      <span>Moy. cache: <strong>{avgC.toFixed(0)}ms</strong> ({ce.length} runs)</span>
                      <span>Moy. raw: <strong>{avgR.toFixed(0)}ms</strong> ({re.length} runs)</span>
                      {gain > 0 ? (
                        <span style={{ color: '#4CAF50' }}>⚡ Gain: <strong>{gain.toFixed(0)}%</strong></span>
                      ) : (
                        <span style={{ color: '#FF9800' }}>Pas de gain significatif</span>
                      )}
                    </div>
                  );
                }
                return null;
              })()}
            </div>
          )}
        </div>
      )}

      {hoveredNode && (
        <div className="sigma-tooltip">
          <i className="bi bi-cursor-fill"></i> <strong>Nœud :</strong> {hoveredNode}
        </div>
      )}

      {renderTime !== null && (
        <div className="sigma-render-time">
          <i className="bi bi-stopwatch"></i> <strong>Sigma.js:</strong> {renderTime.toFixed(0)}ms
          {data.nodes.length > 5000 && (
            <span className="optimization-note"> <i className="bi bi-lightning-charge-fill"></i> optimisé</span>
          )}
        </div>
      )}

      {timingDetails && (
        <div className="sigma-timing-details">
          <button className="timing-toggle" onClick={() => setTimingOpen(!timingOpen)}>
            ⏱️ Timing details {timingOpen ? '▼' : '▶'}
          </button>
          {timingOpen && (
            <div className="timing-breakdown">
              <span className="timing-badge graph">Graph build: <strong>{timingDetails.graphBuild.toFixed(1)}ms</strong></span>
              <span className="timing-badge layout">Layout: <strong>{timingDetails.layout.toFixed(1)}ms</strong></span>
              <span className="timing-badge init">Sigma init: <strong>{timingDetails.sigmaInit.toFixed(1)}ms</strong></span>
              <span className="timing-badge events">Events: <strong>{timingDetails.events.toFixed(1)}ms</strong></span>
              <span className="timing-badge render">WebGL render: <strong>{timingDetails.webglRender.toFixed(1)}ms</strong></span>
            </div>
          )}
        </div>
      )}

      <div className="sigma-stats">
        <span><i className="bi bi-circle-fill" style={{ fontSize: '0.6em' }}></i> {data.nodes.length} nœuds</span>
        <span>•</span>
        <span><i className="bi bi-arrow-right" style={{ fontSize: '0.8em' }}></i> {data.edges.length} arêtes</span>
      </div>

      <FpsCounter recording={renderTime !== null} />
    </div>
  );
};

export default SigmaGraphViewer;
