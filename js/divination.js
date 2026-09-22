(function () { try {
(function () {
const page = document.getElementById('page-divine');
if (!page) return;
let mode = 'tarot';
let count = 3;
const store = window.activeStore();
const TAROT = [
{ name: '愚人', icon: 'sun', pos: '新的开始，勇敢出发。', neg: '鲁莽行事，需三思。', detail: '天真无畏的开端。此刻最适合跟随直觉迈出第一步，别怕未知，路上自有风景与贵人。' },
{ name: '魔术师', icon: 'wand', pos: '掌握资源，心想事成。', neg: '空想多于行动。', detail: '你手中早已握有需要的资源与能力。把想法落到行动上，主动出击，一切皆可成。' },
{ name: '女祭司', icon: 'moon', pos: '直觉敏锐，静观其变。', neg: '忽视内心的声音。', detail: '答案不在表面，而在直觉与静默之中。慢下来倾听内心，你会知道该怎么做。' },
{ name: '皇后', icon: 'flower', pos: '丰盛滋养，温柔以待。', neg: '过度付出忽略自己。', detail: '温柔与丰盛正在靠近。好好照顾自己，也大方接纳身边的美好与爱意。' },
{ name: '皇帝', icon: 'crown', pos: '稳固掌控，责任担当。', neg: '固执己见，控制过强。', detail: '秩序与责任带来稳固。用理性掌控局面，你比想象中更有力量。' },
{ name: '教皇', icon: 'book', pos: '遵循传统，获得指引。', neg: '墨守成规，缺乏变通。', detail: '此时遵循经验与传统会更有帮助。向信任的人请教，会得到可靠的指引。' },
{ name: '恋人', icon: 'heart', pos: '选择与联结，心意相通。', neg: '摇摆不定，沟通受阻。', detail: '重要的选择与联结正在发生。诚实面对心意，彼此靠近才能走得更远。' },
{ name: '战车', icon: 'chariot', pos: '坚定前进，掌控方向。', neg: '失去方向，内耗拉扯。', detail: '方向已经明确，只管坚定向前。专注目标，别被路上的杂音分心。' },
{ name: '力量', icon: 'lion', pos: '温柔的力量，勇气在心。', neg: '缺乏自信，逞强硬撑。', detail: '真正的力量是温柔与耐心。以柔克刚，你能化解眼前的难题。' },
{ name: '隐士', icon: 'lamp', pos: '独处思考，寻找答案。', neg: '孤僻封闭，拒绝帮助。', detail: '独处的时光正是成长的养分。给自己一点安静，答案会自己浮现。' },
{ name: '命运之轮', icon: 'wheel', pos: '时来运转，顺势而行。', neg: '运势波动，随遇而安。', detail: '时机正在转动，顺势而为。抓住变化的窗口，好运悄然靠近。' },
{ name: '正义', icon: 'scales', pos: '公平公正，理性裁决。', neg: '偏见失衡，犹豫不决。', detail: '因果分明，公道自在人心。坦然面对决定，真实会被看见。' },
{ name: '倒吊人', icon: 'hanged', pos: '换个角度，暂停思考。', neg: '无谓牺牲，停滞不前。', detail: '换个角度看问题，也许困局另有出口。暂停不是放弃，是为了更好的出发。' },
{ name: '死神', icon: 'skull', pos: '结束与新生，翻篇向前。', neg: '抗拒改变，迟迟不放。', detail: '旧章已经翻过，新页正在展开。放下执念，改变会带来意想不到的礼物。' },
{ name: '节制', icon: 'cup', pos: '平衡调和，恰到好处。', neg: '失衡过度，缺乏节制。', detail: '一切讲究平衡。恰到好处的付出与等待，会让事情走向圆满。' },
{ name: '恶魔', icon: 'devil', pos: '看清执念，挣脱束缚。', neg: '深陷欲望，难以自拔。', detail: '看清什么在捆绑你。放下执念与贪求，你会发现自由其实唾手可得。' },
{ name: '高塔', icon: 'tower', pos: '突变的觉醒，打破僵局。', neg: '恐慌不安，逃避现实。', detail: '突如其来的变化带来清醒。打破旧结构，反而会开启真正的成长。' },
{ name: '星星', icon: 'star', pos: '希望之光，心愿可期。', neg: '信心受挫，暂时暗淡。', detail: '希望与心愿在远方发光。保持相信，你的愿望正在一步步靠近。' },
{ name: '月亮', icon: 'crescent', pos: '直觉与幻象，看清真相。', neg: '不安迷惘，被情绪困住。', detail: '真相藏在情绪与幻象之下。别急着下结论，看清之后再做决定。' },
{ name: '太阳', icon: 'sunny', pos: '光明坦途，喜悦丰收。', neg: '短暂的阴霾，乐观仍在。', detail: '光明坦荡，喜悦将至。大胆展示真实的自己，好运自会相迎。' },
{ name: '审判', icon: 'trumpet', pos: '觉醒重生，重要抉择。', neg: '悔恨自省，难以原谅。', detail: '觉醒的时刻到了。回望过去，原谅自己，然后带着清明重新出发。' },
{ name: '世界', icon: 'globe', pos: '圆满达成，新的循环。', neg: '功亏一篑，尚需收尾。', detail: '一段旅程圆满落幕。好好庆祝，也准备好迎接新的开始。' },
{ name: '权杖王牌', icon: 'staff', pos: '行动力迸发，新契机。', neg: '冲动行事，虎头蛇尾。', detail: '一团火种落进手里。想做的事现在就可以动起来，热情是最强的燃料。' },
{ name: '权杖二', icon: 'staff', pos: '掌控全局，迈出计划。', neg: '犹豫不决，安于现状。', detail: '世界在手中展开。计划已经成形，勇敢迈出第一步，格局由你定。' },
{ name: '权杖三', icon: 'staff', pos: '进展顺利，远见有成。', neg: '视野受限，等待受阻。', detail: '船已出港，风正在吹。保持远望，你的付出开始有了回音。' },
{ name: '权杖四', icon: 'staff', pos: '庆祝与安稳，喜事临门。', neg: '过渡期动荡，根基不稳。', detail: '值得庆祝的时刻。安定下来的喜悦，好好享受眼下的团圆与收获。' },
{ name: '权杖五', icon: 'staff', pos: '良性竞争，激发斗志。', neg: '纷争内耗，冲突升级。', detail: '场面上有些吵闹。把竞争当成磨刀石，别让争执伤了真正的感情。' },
{ name: '权杖六', icon: 'staff', pos: '胜利凯旋，获得认可。', neg: '骄傲自满，风光不再。', detail: '掌声响起。你的努力被看见了，接受赞美，也记住来时的路。' },
{ name: '权杖七', icon: 'staff', pos: '坚守立场，以少胜多。', neg: '力不从心，节节败退。', detail: '一人守住高地。眼下是考验耐心的时刻，站稳了，你就赢了。' },
{ name: '权杖八', icon: 'staff', pos: '消息速至，进展飞快。', neg: '节奏混乱，延误迟滞。', detail: '八支权杖齐飞。事情正在加速推进，好消息很快会抵达。' },
{ name: '权杖九', icon: 'staff', pos: '韧性十足，胜利在望。', neg: '疲惫设防，草木皆兵。', detail: '带伤仍站立。你已经走了很远，最后一步咬咬牙就到。' },
{ name: '权杖十', icon: 'staff', pos: '负重前行，接近终点。', neg: '不堪重负，学会放手。', detail: '肩上的担子不少。有些可以放下，别把所有事都扛在自己身上。' },
{ name: '权杖侍从', icon: 'page', pos: '好奇心旺，跃跃欲试。', neg: '三分钟热度，浅尝辄止。', detail: '新点子冒头。保持好奇去尝试，热情会让路越走越宽。' },
{ name: '权杖骑士', icon: 'knight', pos: '热情行动，敢闯敢冲。', neg: '横冲直撞，缺乏耐心。', detail: '骑手疾驰而来。行动派的时刻，冲劲可贵，方向要对。' },
{ name: '权杖王后', icon: 'queen', pos: '自信温暖，感染力强。', neg: '强势张扬，忽视他人。', detail: '她自带光芒。用你的热情点亮周围，温柔与力量可以并存。' },
{ name: '权杖国王', icon: 'king', pos: '远见领导，魄力十足。', neg: '独断专行，刚愎自用。', detail: '他稳坐中军。以远见和魄力掌舵，是带领大家前进的时候。' },
{ name: '圣杯王牌', icon: 'cup', pos: '情感新生，心流涌动。', neg: '压抑情感，错失心动。', detail: '杯子满溢。心底涌起的情感是真的，接住它，别装作没看见。' },
{ name: '圣杯二', icon: 'cup', pos: '心意相通，彼此回应。', neg: '失衡的关系，貌合神离。', detail: '两只杯子轻碰。彼此的回应正在发生，这是最动人的默契。' },
{ name: '圣杯三', icon: 'cup', pos: '欢聚分享，友情升温。', neg: '圈层纷扰，流言是非。', detail: '三人举杯。和朋友多聚聚，喜悦会因为分享而成倍增长。' },
{ name: '圣杯四', icon: 'cup', pos: '静心审视，重新出发。', neg: '倦怠冷漠，错过机会。', detail: '树下的沉思。对眼前有些提不起劲？不妨先看看手里已有的。' },
{ name: '圣杯五', icon: 'cup', pos: '接纳遗憾，珍惜尚存。', neg: '沉溺失落，无视所有。', detail: '打翻了几杯，还有立着的。别只盯着洒掉的，转身还有余地。' },
{ name: '圣杯六', icon: 'cup', pos: '纯真回忆，旧情重温。', neg: '困于过去，拒绝长大。', detail: '旧日的花开着。一段回忆或旧识带来温暖，怀念但不沉溺。' },
{ name: '圣杯七', icon: 'cup', pos: '梦想丰富，择善而行。', neg: '空想迷乱，脱离现实。', detail: '云中满是幻影。选择很多，把最真的那个落到现实里。' },
{ name: '圣杯八', icon: 'cup', pos: '告别过去，寻找意义。', neg: '逃避出走，徘徊不定。', detail: '转身离开的时刻。有些路要走远一点才明白，出发吧。' },
{ name: '圣杯九', icon: 'cup', pos: '心愿得偿，心满意足。', neg: '表面满足，内心空虚。', detail: '愿望成真的甜。享受此刻的丰盛，你值得。' },
{ name: '圣杯十', icon: 'cup', pos: '情感圆满，幸福满溢。', neg: '理想幻灭，家庭失和。', detail: '彩虹下举杯的一家。这是情感牌里最好的画面，用心经营就能抵达。' },
{ name: '圣杯侍从', icon: 'page', pos: '灵感萌动，纯真表达。', neg: '情绪化，幼稚任性。', detail: '捧着杯子的小小信号。一句真诚的表达，就能拉近彼此。' },
{ name: '圣杯骑士', icon: 'knight', pos: '浪漫告白，心意送达。', neg: '多愁善感，承诺空洞。', detail: '浪漫的骑士来了。甜蜜的消息或告白正在路上，用心回应。' },
{ name: '圣杯王后', icon: 'queen', pos: '温柔共情，善解人意。', neg: '情绪泛滥，过度付出。', detail: '她懂你未说出口的话。用温柔接住彼此，也别忘了照顾自己。' },
{ name: '圣杯国王', icon: 'king', pos: '沉稳包容，情感成熟。', neg: '情感封闭，压抑克制。', detail: '他平静如深海。成熟的关怀不喧哗，稳定本身就是力量。' },
{ name: '宝剑王牌', icon: 'sword', pos: '思路清明，一语中的。', neg: '言语伤人，思维混乱。', detail: '剑已出鞘。看清真相的时刻，理性的光会劈开迷雾。' },
{ name: '宝剑二', icon: 'sword', pos: '权衡利弊，静待时机。', neg: '回避抉择，僵持不下。', detail: '蒙眼持剑的平衡。决定先放一放没关系，但别永远闭着眼。' },
{ name: '宝剑三', icon: 'sword', pos: '直面伤痛，痛后清明。', neg: '心碎难愈，反复内耗。', detail: '心上有剑的痕迹。疼是真的，但这疼会让你看得更清楚。' },
{ name: '宝剑四', icon: 'sword', pos: '休整蓄力，静养生息。', neg: '消极避世，恢复缓慢。', detail: '静卧的骑士。允许自己休息，恢复是下一步行动的一部分。' },
{ name: '宝剑五', icon: 'sword', pos: '思辨胜出，以理服人。', neg: '赢了道理，输了人心。', detail: '胜负已分。想想你要的到底是赢，还是关系。' },
{ name: '宝剑六', icon: 'sword', pos: '驶离困境，渐入佳境。', neg: '旧事纠缠，难以脱身。', detail: '船正驶向平静水域。离开消耗你的环境，前方会好起来。' },
{ name: '宝剑七', icon: 'sword', pos: '巧思破局，机智应对。', neg: '投机取巧，暗中行事。', detail: '有人悄悄拿走了什么。策略可以用，但别用在亲近的人身上。' },
{ name: '宝剑八', icon: 'sword', pos: '突破自设，挣脱束缚。', neg: '自我设限，画地为牢。', detail: '束缚多是自己系的。绳子没那么紧，你随时可以走。' },
{ name: '宝剑九', icon: 'sword', pos: '正视焦虑，黎明将至。', neg: '失眠忧虑，噩梦缠身。', detail: '夜半惊坐起。焦虑在放大问题，天亮再看看，没那么糟。' },
{ name: '宝剑十', icon: 'sword', pos: '谷底翻转，触底新生。', neg: '彻底崩溃，结束难熬。', detail: '最坏的时刻。既然已到谷底，往哪走都是向上。' },
{ name: '宝剑侍从', icon: 'page', pos: '敏锐观察，勤学好问。', neg: '机灵过头，言语轻率。', detail: '举着剑的小侦探。多看多问少下结论，信息就是你的武器。' },
{ name: '宝剑骑士', icon: 'knight', pos: '果敢直言，雷厉风行。', neg: '言语尖锐，咄咄逼人。', detail: '风向变了，他冲在最前。有话直说是好事，注意别带刺。' },
{ name: '宝剑王后', icon: 'queen', pos: '清醒独立，明辨是非。', neg: '冷漠苛刻，理性过头。', detail: '她的眼睛容不下沙子。保持清醒很好，但心不是法庭。' },
{ name: '宝剑国王', icon: 'king', pos: '权威公正，理性裁决。', neg: '专断严苛，铁面无情。', detail: '他以理智执政。规则和公正是你的底气，人情也是。' },
{ name: '星币王牌', icon: 'coin', pos: '机会落地，财运开启。', neg: '错失良机，财来财去。', detail: '手里落下一枚金币。一个实实在在的机会出现了，握住它。' },
{ name: '星币二', icon: 'coin', pos: '灵活统筹，游刃有余。', neg: '两头兼顾，顾此失彼。', detail: '他在抛接两枚金币。多线并行考验平衡，节奏对了就稳。' },
{ name: '星币三', icon: 'coin', pos: '技艺精进，协作有成。', neg: '配合不畅，标准不一。', detail: '图纸前的商量。把专业的事交给专业的人，合作出精品。' },
{ name: '星币四', icon: 'coin', pos: '守住成果，稳中求进。', neg: '过度保守，抓得太紧。', detail: '他紧紧抱着金币。安全感重要，但钱也要会流动才有生命力。' },
{ name: '星币五', icon: 'coin', pos: '同舟共济，共渡难关。', neg: '捉襟见肘，孤立无援。', detail: '风雪中的赶路人。眼下紧一点没关系，身边有人一起走。' },
{ name: '星币六', icon: 'coin', pos: '给予与收获，有来有往。', neg: '施舍失衡，暗藏条件。', detail: '天平在手持。有来有往才是健康的关系，包括金钱。' },
{ name: '星币七', icon: 'coin', pos: '耐心培育，静待花开。', neg: '急于求成，半途而废。', detail: '倚锄守望的人。种下的已经在生长，别拔苗，等一等。' },
{ name: '星币八', icon: 'coin', pos: '专注打磨，精进不止。', neg: '机械重复，无暇抬头。', detail: '雕刻匠人的专注。把一件事做透，时间会给你复利。' },
{ name: '星币九', icon: 'coin', pos: '自立丰足，从容有底。', neg: '依赖成性，虚假富足。', detail: '花园里的从容。你已经有底气了，享受自己挣来的安稳。' },
{ name: '星币十', icon: 'coin', pos: '丰裕传承，家业稳固。', neg: '徒有形式，内里空虚。', detail: '拱门内的家业。长线经营有了模样，稳定是最奢侈的礼物。' },
{ name: '星币侍从', icon: 'page', pos: '踏实好学，脚踏实地。', neg: '目光短浅，动机不纯。', detail: '捧着金币研究的小孩。从眼前的实事学起，根基打牢。' },
{ name: '星币骑士', icon: 'knight', pos: '稳扎稳打，靠谱可靠。', neg: '墨守成规，进展缓慢。', detail: '他不快，但从不失约。慢慢来，比较快。' },
{ name: '星币王后', icon: 'queen', pos: '务实滋养，持家有道。', neg: '操劳过度，忽视情感。', detail: '她把日子过成了花园。照顾好现实，也照顾好心情。' },
{ name: '星币国王', icon: 'king', pos: '富足稳健，事业有成。', neg: '守财固执，物欲至上。', detail: '他坐拥丰饶。责任与收获并存，是享受成果的时候。' }
];
const TAROT_ICONS = {
sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
wand: '<path d="M12 2l2 7 7 2-7 2-2 7-2-7-7-2 7-2z"/>',
moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
flower: '<circle cx="12" cy="10" r="3"/><path d="M12 7V4M12 16v4M12 7a3 3 0 00-3-3M12 7a3 3 0 013-3M12 13a3 3 0 01-3 3M12 13a3 3 0 013 3"/>',
crown: '<path d="M4 18h16M4 18l2-9 5 4 3-6 4 6 4-4 2 9"/>',
book: '<path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>',
heart: '<path d="M12 21s-7.5-4.7-9.3-9A5.3 5.3 0 0112 6.4a5.3 5.3 0 019.3 5.6c-1.8 4.3-9.3 9-9.3 9z"/>',
chariot: '<circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><path d="M5 7v6h14V7M7 13l-2 7M17 13l2 7M3 13h18"/>',
lion: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
lamp: '<path d="M12 2l3 7-3 3-3-3z"/><path d="M12 12v8M8 20h8"/>',
wheel: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"/>',
scales: '<path d="M12 3v18M5 21h14M8 7h8M4 11l4-2 2 6M20 11l-4-2-2 6"/>',
hanged: '<circle cx="12" cy="5" r="2"/><path d="M12 7v10M12 17c-2 0-3-3-3-6M12 17c2 0 3-3 3-6"/>',
skull: '<circle cx="12" cy="12" r="8"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><path d="M10 17h4"/>',
cup: '<path d="M4 10h16v2a8 8 0 01-16 0z"/><path d="M4 10a8 8 0 0116 0"/>',
devil: '<path d="M12 3l7 10.5a4.5 4.5 0 11-7.5 5L12 3z"/><path d="M8.5 15.5a2.5 2.5 0 002 4.5M12 9v6"/>',
tower: '<path d="M12 2l3 10h-6zM9 12l-2 8h10l-2-8"/><path d="M12 15v3"/>',
star: '<path d="M12 2l2.4 5 5.6.8-4 4 .9 5.6-4.9-2.6-4.9 2.6.9-5.6-4-4 5.6-.8z"/>',
crescent: '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/><path d="M12 8l1 3 3 1-3 1-1 3-1-3-3-1 3-1z"/>',
sunny: '<circle cx="12" cy="12" r="5"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3M3.5 3.5l2.1 2.1M18.4 18.4l2.1 2.1M3.5 20.5l2.1-2.1M18.4 5.6l2.1-2.1"/>',
trumpet: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/><path d="M8 4c-1.5 2.5-1.5 13.5 0 16"/>',
globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 010 18M12 3a15 15 0 000 18"/>',
staff: '<path d="M12 3v18M12 8c3 0 5-2 5-5-3 0-5 2-5 5zM12 13c-3 0-5-2-5-5 3 0 5 2 5 5z"/>',
sword: '<path d="M12 2l2.5 11h-5zM12 13v7M9 16h6M9 20h6"/>',
coin: '<circle cx="12" cy="12" r="8"/><path d="M12 7l1.4 2.8 3.1.5-2.2 2.2.5 3.1L12 14.2 9.2 15.6l.5-3.1-2.2-2.2 3.1-.5z"/>',
page: '<circle cx="12" cy="9" r="3"/><path d="M6 20c0-3 3-5 6-5s6 2 6 5M9 5l3-2 3 2"/>',
knight: '<path d="M4 16l3-4 5 0 4-6 3 2-1 4 3 4M7 12l-3 2M4 18h3"/>',
queen: '<circle cx="12" cy="9" r="3"/><path d="M6 20c0-3 3-5 6-5s6 2 6 5M7 6l2.5 1L12 4l2.5 3L17 6"/>',
king: '<circle cx="12" cy="9" r="3"/><path d="M6 20c0-3 3-5 6-5s6 2 6 5M8 5l1.3 2L12 5l2.7 2L16 5"/>'
};
const LENO = [
{ name: '骑士', icon: 'horse', meaning: '迅速的行动与消息。', detail: '有消息正快速赶来，行动要快，机会不等人。' },
{ name: '四叶草', icon: 'clover', meaning: '小小的幸运与惊喜。', detail: '小小的幸运正在靠近，别错过手边的机会。' },
{ name: '船', icon: 'ship', meaning: '远行与旅程。', detail: '一段新的旅程或变动即将展开，走出去会有收获。' },
{ name: '房子', icon: 'house', meaning: '安稳的归属。', detail: '安稳与归属感，家和熟悉的环境给你力量。' },
{ name: '树', icon: 'tree', meaning: '成长与健康。', detail: '健康与成长，慢而稳地扎根，终会枝繁叶茂。' },
{ name: '云', icon: 'cloud', meaning: '暂时的迷雾与不确定。', detail: '眼前有些迷雾，等它散去再做决定也不迟。' },
{ name: '蛇', icon: 'snake', meaning: '潜在的考验与转折。', detail: '留意潜在的小转折，谨慎行事，别有疏漏。' },
{ name: '棺材', icon: 'coffin', meaning: '结束与新的开始。', detail: '结束即开始，清理旧物旧事，才能迎来新气象。' },
{ name: '花束', icon: 'bouquet', meaning: '美好与馈赠。', detail: '收到馈赠或美好，心情愉快，值得好好珍惜。' },
{ name: '镰刀', icon: 'scythe', meaning: '果断的切割。', detail: '果断切断消耗你的事物，干净利落反而轻松。' },
{ name: '鞭子', icon: 'whip', meaning: '反复与提醒。', detail: '反复出现的提醒，重视它，别一再绕开。' },
{ name: '鸟', icon: 'bird', meaning: '交谈与消息。', detail: '交谈与消息频繁，多沟通，信息里有答案。' },
{ name: '孩子', icon: 'child', meaning: '新生的开始。', detail: '一个全新的开始，保持天真，一切皆有可能。' },
{ name: '狐狸', icon: 'fox', meaning: '机智与谨慎。', detail: '多留个心眼，聪明应对，别轻信表面。' },
{ name: '熊', icon: 'bear', meaning: '力量与保护。', detail: '力量与守护，依靠坚定的后盾，大胆前行。' },
{ name: '星星', icon: 'star', meaning: '愿望与指引。', detail: '愿望有指引，许愿正当时，保持相信。' },
{ name: '鹤', icon: 'stork', meaning: '变化与喜讯。', detail: '好消息临近，变动带来喜讯，静候佳音。' },
{ name: '狗', icon: 'dog', meaning: '忠诚的陪伴。', detail: '忠诚与陪伴，可靠的朋友就在身边。' },
{ name: '塔', icon: 'tower', meaning: '独立与高度。', detail: '独立与高度，站得高看得远，格局打开。' },
{ name: '花园', icon: 'garden', meaning: '聚会与社交。', detail: '聚会与社交，人际往来会带来新机会。' },
{ name: '山', icon: 'mountain', meaning: '挑战与坚持。', detail: '前路有挑战，坚持就是胜利，翻过山就好。' },
{ name: '路口', icon: 'crossroad', meaning: '面临选择。', detail: '面临选择，倾听内心的声音，路在脚下。' },
{ name: '老鼠', icon: 'mouse', meaning: '细小的损耗。', detail: '细小损耗在发生，及时止损，别让小问题变大。' },
{ name: '心', icon: 'heart', meaning: '真挚的情感。', detail: '真挚的情感，感情上会有回应，大胆表达。' },
{ name: '戒指', icon: 'ring', meaning: '承诺与契约。', detail: '承诺与契约，重要关系更进一步，值得期待。' },
{ name: '信', icon: 'letter', meaning: '书面的消息。', detail: '书面消息将带来答案，留意来信与文字。' },
{ name: '书', icon: 'book', meaning: '知识或秘密。', detail: '知识或秘密，深入学习会有所得，也守好秘密。' },
{ name: '男人', icon: 'man', meaning: '一位重要的男性。', detail: '一位重要的男性将带来影响，留意他的态度。' },
{ name: '女人', icon: 'woman', meaning: '一位重要的女性。', detail: '一位重要的女性将带来影响，多听听她的看法。' },
{ name: '百合', icon: 'lily', meaning: '平静与纯净。', detail: '平静与纯净，心绪归宁，沉淀之后更清明。' },
{ name: '太阳', icon: 'sunny', meaning: '成功与光明。', detail: '成功与光明，事情终将明朗，全力以赴即可。' },
{ name: '月亮', icon: 'crescent', meaning: '直觉与情感。', detail: '直觉与情感，夜晚适合倾听内心，跟随感受。' },
{ name: '钥匙', icon: 'key', meaning: '答案与机会。', detail: '答案与机会就在手边，去开启它，别犹豫。' },
{ name: '鱼', icon: 'fish', meaning: '富足与资源。', detail: '富足与资源，财运转好，善用流动的机会。' },
{ name: '锚', icon: 'anchor', meaning: '稳定与安全。', detail: '稳定与安全，心有所系，根基牢固。' },
{ name: '十字架', icon: 'cross', meaning: '信念与考验。', detail: '信念受考验，坚持初心，熬过即是成长。' },
{ name: '灵体', icon: 'spirit', meaning: '直觉与灵感。', detail: '直觉与灵感增强，相信第六感，它会带路。' },
{ name: '香炉', icon: 'incense', meaning: '沉淀与净化。', detail: '沉淀与净化，清空杂念，轻装上阵。' },
{ name: '床', icon: 'bed', meaning: '休息与私密。', detail: '休息与私密，好好休整，睡眠也是疗愈。' },
{ name: '市场', icon: 'market', meaning: '交易与机会。', detail: '交易与机会，新的可能正在酝酿，值得一试。' }
];
const LENO_ICONS = {
horse: '<path d="M4 16l3-4 5 0 4-6 3 2-1 4 3 4M7 12l-3 2M4 18h3"/>',
clover: '<line x1="12" y1="4" x2="12" y2="20"/><circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><circle cx="12" cy="14" r="3"/>',
ship: '<path d="M3 16h18l-3 5H6zM12 16V6M8 6h8"/>',
house: '<path d="M4 20V9l8-6 8 6v11M9 20v-6h6v6"/>',
tree: '<path d="M12 3l4 7h-2.5l3 6H12M12 3L8 10h2.5l-3 6H12"/><path d="M12 16v4"/>',
cloud: '<path d="M17 19a4 4 0 000-8 5.5 5.5 0 00-11 1A3.5 3.5 0 006.5 19z"/>',
snake: '<path d="M4 15s3-2 6 0 6 2 8 0M4 15l-1-3M20 15l1-3"/><circle cx="4" cy="19" r="1"/>',
coffin: '<path d="M8 3h8l-1 18H9zM9 9h6"/>',
bouquet: '<circle cx="12" cy="9" r="3"/><path d="M12 6V3M10 8l-3 1M14 8l3 1M12 12v8M8 17l2-1M16 17l-2-1"/>',
scythe: '<path d="M4 20L14 10M14 10c4-1 6-3 6-6-3 0-5 2-6 6z"/>',
whip: '<path d="M4 5h10M8 5l-1 14M4 9l4-4M18 5h2"/>',
bird: '<path d="M3 14c3-5 15-5 18 0-3-1-15-1-18 0zM7 14l-2 4M17 14l2 4"/>',
child: '<circle cx="12" cy="8" r="3"/><path d="M6 18c0-3 3-5 6-5s6 2 6 5"/>',
fox: '<path d="M8 6l-2-2 2 3a4 4 0 016 0l2-3-2 2 1 2-1 6h-6z"/><path d="M10 15v2M14 15v2"/>',
bear: '<circle cx="12" cy="10" r="6"/><circle cx="9" cy="8" r="1.5"/><circle cx="15" cy="8" r="1.5"/><path d="M12 14l-1 4M12 14l1 4"/>',
star: '<path d="M12 2l2.4 5 5.6.8-4 4 .9 5.6-4.9-2.6-4.9 2.6.9-5.6-4-4 5.6-.8z"/>',
stork: '<path d="M12 3v18M12 6c-3 0-5 3-5 6 0 3 2 6 5 6M12 6c3 0 5 3 5 6 0 3-2 6-5 6"/><path d="M12 8v8"/>',
dog: '<circle cx="9" cy="9" r="4"/><circle cx="15" cy="9" r="4"/><path d="M7 13l-2 8 4-3M17 13l2 8-4-3M9 13v5M15 13v5"/>',
tower: '<path d="M9 3h6l-1 17h-4zM7 8h10"/>',
garden: '<circle cx="8" cy="15" r="4"/><circle cx="16" cy="13" r="5"/><path d="M12 2l1 3 3 1-3 1-1 3-1-3-3-1 3-1z"/>',
mountain: '<path d="M3 20L10 6l4 8 3-5 4 11z"/>',
crossroad: '<path d="M12 3v18M3 12h18"/><path d="M12 3l-3 3 3 3 3-3z"/>',
mouse: '<path d="M6 12a6 6 0 0112 0v4H6zM9 12v-3M15 12v-3M6 16v3M18 16v3"/><circle cx="8" cy="10" r=".8"/><circle cx="16" cy="10" r=".8"/>',
heart: '<path d="M12 21s-7.5-4.7-9.3-9A5.3 5.3 0 0112 6.4a5.3 5.3 0 019.3 5.6c-1.8 4.3-9.3 9-9.3 9z"/>',
ring: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
letter: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 8l9 6 9-6"/>',
book: '<path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>',
man: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6"/>',
woman: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6"/><path d="M12 2v2"/>',
lily: '<path d="M12 3l-2 5 4 0zM12 8v10M10 18h4M12 12c-3 0-4 3-4 6h0c2 0 3-2 4-3 1 1 2 3 4 3h0c0-3-1-6-4-6z"/>',
sunny: '<circle cx="12" cy="12" r="5"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3M3.5 3.5l2.1 2.1M18.4 18.4l2.1 2.1M3.5 20.5l2.1-2.1M18.4 5.6l2.1-2.1"/>',
crescent: '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>',
key: '<circle cx="7" cy="17" r="4"/><path d="M10 14L20 4M16 8l3 3"/>',
fish: '<path d="M3 12c4-5 14-5 18 0-4 5-14 5-18 0z"/><path d="M14 12h6"/><circle cx="6" cy="12" r=".8"/>',
anchor: '<circle cx="12" cy="4" r="2"/><path d="M12 6v14M5 12h14M8 20h8M12 6a8 8 0 01-4 6"/>',
cross: '<path d="M12 3v18M5 12h14"/><circle cx="12" cy="12" r="8"/>',
spirit: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
incense: '<path d="M12 3l1 3h-2zM12 6v6M9 18h6M10 21h4"/><path d="M12 12c-3 0-4 2-4 4h8c0-2-1-4-4-4z"/>',
bed: '<path d="M3 18v-8h18v8M3 14h18M7 18v-4M17 18v-4"/><circle cx="7" cy="9" r="2"/>',
market: '<path d="M4 5h16l-2 12H6zM9 5v3M15 5v3M6 17h12l1 3H5z"/>'
};
const MODE_LABELS = {
tarot: { 1: ['运势'], 3: ['过去', '现在', '未来'], 7: ['过去', '现在', '未来', '阻碍', '助力', '态度', '结果'] },
lenormand: { 1: ['回复'], 3: ['回复 1', '回复 2', '回复 3'], 7: ['回复 1', '回复 2', '回复 3', '回复 4', '回复 5', '回复 6', '回复 7'] }
};
window.__TAROT__ = TAROT;
window.__LENO__ = LENO;
window.__TAROT_ICONS__ = TAROT_ICONS;
window.__LENO_ICONS__ = LENO_ICONS;
window.__MODE_LABELS__ = MODE_LABELS;
const GNS = 'xy-home-v2';
const gStore = window.xyStore(GNS);
const FACE_IDX_KEY = 'divine-faces-idx';
const LENO36_KEY = 'divine-leno-36';
const FACE_PREFIX = '@df:';
const ORIG_ICON = { tarot: {}, lenormand: {} };
TAROT.forEach(c => { ORIG_ICON.tarot[c.name] = c.icon; });
LENO.forEach(c => { ORIG_ICON.lenormand[c.name] = c.icon; });
const faceThb = new Map();   // 'mode|牌名' -> 缩略图 dataURL
let facePanelCid = 'tarot';  // 管理面板当前体系
let faceTab = 'manage';      // manage | gallery
let pendingUpload = null;    // { m, n } 待上传的牌
let facePanelScroll = 0;     // 浮层打开前的占卜页滚动位置（关闭时还原）
let leno36 = false;          // 雷诺曼 36（经典）/ 40（含扩展）
const ONEBASED_KEY = 'divine-face-onebased';
let faceOneBased = false;
try { faceOneBased = gStore.get(ONEBASED_KEY) === '1'; } catch (e) {}
function obBtn_sync() {
const b = document.getElementById('divf-onebased');
if (b) {
b.textContent = '编号从 1 起（塔罗 1–78）：' + (faceOneBased ? '开' : '关');
b.setAttribute('aria-pressed', faceOneBased ? 'true' : 'false');
}
}
function isFaceKey(k) { return typeof k === 'string' && k.indexOf(FACE_PREFIX) === 0; }
function faceKey(m, n) { return FACE_PREFIX + m + ':' + n; }
function faceParse(k) {
const s = k.slice(FACE_PREFIX.length);
const i = s.indexOf(':');
return { m: s.slice(0, i), n: s.slice(i + 1) };
}
function encN(n) { return encodeURIComponent(n); }
function fullKey(m, n) { return 'divine-face-' + m + '-' + encN(n); }
function thbKey(m, n) { return 'divine-face-thb-' + m + '-' + encN(n); }
function iconMapOf(m) { return m === 'tarot' ? TAROT_ICONS : LENO_ICONS; }
function cardOf(m, n) {
const a = m === 'tarot' ? TAROT : LENO;
for (let i = 0; i < a.length; i++) if (a[i].name === n) return a[i];
return null;
}
function escHtml(s) {
return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
.replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function dtStamp() {
const d = new Date();
const p = (n) => (n < 10 ? '0' + n : '' + n);
return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
}
function loadFaceIdx() {
let arr = [];
try { arr = JSON.parse(gStore.get(FACE_IDX_KEY) || '[]'); } catch (e) { arr = []; }
return Array.isArray(arr) ? arr.filter(x =>
x && (x.m === 'tarot' || x.m === 'lenormand') && x.n && cardOf(x.m, x.n)) : [];
}
function saveFaceIdx(arr) { try { gStore.set(FACE_IDX_KEY, JSON.stringify(arr)); } catch (e) {} }
function applyFace(m, n) {
const thb = faceThb.get(m + '|' + n);
const c = cardOf(m, n);
if (!thb || !c) return;
const k = faceKey(m, n);
iconMapOf(m)[k] = '<image href="' + thb + '" x="0" y="0" width="24" height="24" preserveAspectRatio="xMidYMid slice"/>';
c.icon = k;
}
function storeFaceFromDataUrls(m, n, full, thb) {
try { gStore.set(fullKey(m, n), full); } catch (e) {}
try { gStore.set(thbKey(m, n), thb); } catch (e) {}
const idx = loadFaceIdx();
if (!idx.some(x => x.m === m && x.n === n)) idx.push({ m: m, n: n, t: Date.now() });
saveFaceIdx(idx);
faceThb.set(m + '|' + n, thb);
applyFace(m, n);
}
const CN_DIGIT = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
function varifyName(nm) {
let out = [nm];
if (/王牌$/.test(nm)) {
const stem = nm.slice(0, -2);
out = out.concat([stem + 'A', stem + '1', stem + '0']);
}
const cm = nm.match(/([一二三四五六七八九十]+)$/);
if (cm) {
const d = CN_DIGIT[cm[1]];
if (d) out.push(nm.slice(0, nm.length - cm[1].length) + d);
}
return out;
}
function aliasHit(s, v) {
if (s === v) return true;
if (!v) return false;
const DIGIT = /[0-9０-９]/;
if (!/[0-9０-９]$/.test(v)) return s.indexOf(v) >= 0;
for (let i = s.indexOf(v); i >= 0; i = s.indexOf(v, i + 1)) {
if (!DIGIT.test(s.charAt(i + v.length))) return true;
}
return false;
}
function matchFaceFile(rawName, defaultMode, oneBased = faceOneBased) {
let s = String(rawName || '').replace(/\.[A-Za-z0-9]+$/, '').trim();
if (!s) return null;
s = s.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFF10 + 48));
let mode = '';
const mp = s.match(/^(塔罗牌?|雷诺曼|雷诺|lenormand|lennormand|leno|len|tarot|taro)[\s._\-:：]*/i);
if (mp) {
const t = mp[1].toLowerCase();
mode = (t.charAt(0) === '塔' || t.indexOf('tar') === 0) ? 'tarot' : 'lenormand';
s = s.slice(mp[0].length).trim();
}
if (!s) return null;
const numOf = (num) => {
const m = mode || defaultMode || 'tarot';
if (m === 'tarot') { const i = oneBased ? num - 1 : num; if (i >= 0 && i < TAROT.length) return { m: 'tarot', n: TAROT[i].name }; }
else { const i = num - 1; if (i >= 0 && i < LENO.length) return { m: 'lenormand', n: LENO[i].name }; }
return null;
};
if (/^\d+$/.test(s)) return numOf(parseInt(s, 10));
let lead = null;
const lm = s.match(/^(\d+)[\s._\-、:：#]*/);
if (lm) { lead = parseInt(lm[1], 10); s = s.slice(lm[0].length).trim(); }
s = s.replace(/(\D)0+([1-9])/, '$1$2');
if (s) {
const cands = [];
[['tarot', TAROT], ['lenormand', LENO]].forEach(([m, arr]) => {
arr.forEach(c => {
varifyName(c.name).forEach(v => {
if (!aliasHit(s, v)) return;
cands.push({ m: m, n: c.name, exact: s === v, len: v.length });
});
});
});
if (cands.length) {
if (mode) { const f = cands.find(x => x.m === mode); if (f) return { m: f.m, n: f.n }; }
const exacts = cands.filter(x => x.exact);
const pool = exacts.length ? exacts : cands.sort((a, b) => b.len - a.len);
const pref = pool.find(x => x.m === defaultMode);
const pick = pref || pool[0];
return { m: pick.m, n: pick.n };
}
}
if (lead !== null) return numOf(lead);
return null;
}
function rebuildFaces() {
const want = {};
loadFaceIdx().forEach(x => { if (faceThb.get(x.m + '|' + x.n)) want[x.m + '|' + x.n] = true; });
['tarot', 'lenormand'].forEach(m => {
(m === 'tarot' ? TAROT : LENO).forEach(c => {
const wk = m + '|' + c.name, k = faceKey(m, c.name);
if (want[wk]) { applyFace(m, c.name); return; }
if (c.icon === k) c.icon = ORIG_ICON[m][c.name];
iconMapOf(m)[k] = iconMapOf(m)[ORIG_ICON[m][c.name]] || '';
});
});
}
function loadFaces() {
faceThb.clear();
loadFaceIdx().forEach(x => {
let thb = null;
try { thb = gStore.get(thbKey(x.m, x.n)); } catch (e) {}
if (typeof thb === 'string' && thb) faceThb.set(x.m + '|' + x.n, thb);
});
rebuildFaces();
try { renderFaceList(); renderFaceGallery(); } catch (e) {}
}
function rmFaceData(m, n) {
try { gStore.remove(fullKey(m, n)); } catch (e) {}
try { gStore.remove(thbKey(m, n)); } catch (e) {}
faceThb.delete(m + '|' + n);
}
function compressImg(dataUrl, maxSide, quality) {
return new Promise((resolve) => {
if (typeof dataUrl === 'string' && dataUrl.length > 8 * 1024 * 1024) { resolve(null); return; }
const img = new Image();
img.onload = () => {
try {
if (img.width * img.height > 26000000) { resolve(null); return; }
const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
const w = Math.max(1, Math.round(img.width * scale));
const h = Math.max(1, Math.round(img.height * scale));
const cv = document.createElement('canvas');
cv.width = w; cv.height = h;
cv.getContext('2d').drawImage(img, 0, 0, w, h);
resolve(cv.toDataURL('image/jpeg', quality));
} catch (e) { resolve(null); }
};
img.onerror = () => resolve(null);
img.src = dataUrl;
});
}
try { leno36 = gStore.get(LENO36_KEY) === '1'; } catch (e) { leno36 = false; }
function lenoDeck() { return leno36 ? LENO.slice(0, 36) : LENO; }
function syncLenoSys() {
const wrap = document.getElementById('div-leno-sys');
if (wrap) {
wrap.hidden = mode !== 'lenormand';
wrap.querySelectorAll('.div-mode').forEach(b => {
b.classList.toggle('sel', (b.dataset.lenosys === '36') === leno36);
});
}
const cw = document.getElementById('div-chat-leno-sys');
if (cw) {
const sel = document.querySelector('#chat-divine-body [data-chatmode].sel');
const cmode = sel ? sel.getAttribute('data-chatmode') : 'tarot';
cw.hidden = cmode !== 'lenormand';
cw.querySelectorAll('.div-mode').forEach(b => {
b.classList.toggle('sel', (b.dataset.lenosys === '36') === leno36);
});
}
}
try {
Object.defineProperty(window, '__LENO__', { get: lenoDeck, configurable: true });
} catch (e) { window.__LENO__ = LENO; }
let divineTarget = '';   // '' = 不选（存到当前桌面）
let homePending = [];    // IDB 回填完成前暂存的待写主页记录
function curStore() { return (window.activeStore && window.activeStore()) || store; }
function targetName(cid) {
cid = cid || (window.__activeCid || 'default');
try {
let v = '';
if (cid === (window.__activeCid || 'default')) {
const s = curStore();
v = s.get('lbl-partner') || s.get('cs-lbl-partner') || '';
} else {
const s = window.storeFor(cid);
v = s.get('lbl-partner') || s.get('cs-lbl-partner') || '';
}
return v || (window.contactNameFor ? window.contactNameFor(cid) : '') || (window.taWordFor ? window.taWordFor(cid) : 'TA');
} catch (e) { return 'TA'; }
}
function loadDivineTarget() {
try { divineTarget = curStore().get('divine-target') || ''; } catch (e) { divineTarget = ''; }
if (divineTarget && window.getContacts && !window.getContacts().some(c => c && c.id === divineTarget)) divineTarget = '';
}
function syncTargets() {
document.querySelectorAll('[data-dtarget]').forEach(b =>
b.classList.toggle('sel', (b.getAttribute('data-dtarget') || '') === divineTarget));
}
function renderTargetsInto(id) {
const el = document.getElementById(id);
if (!el) return;
loadDivineTarget();
const contacts = (window.getContacts && window.getContacts()) || [];
const chips = [{ cid: '', label: '不选' }];
contacts.forEach(c => { if (c && c.id) chips.push({ cid: c.id, label: targetName(c.id) }); });
el.innerHTML = chips.map(x =>
'<button type="button" class="div-mode' + ((x.cid || '') === divineTarget ? ' sel' : '') +
'" data-dtarget="' + escHtml(x.cid || '') + '">' + escHtml(x.label) + '</button>').join('');
if (!el.dataset.dtBound) {
el.dataset.dtBound = '1';
el.addEventListener('click', (e) => {
const b = e.target.closest('[data-dtarget]');
if (!b) return;
divineTarget = b.getAttribute('data-dtarget') || '';
try { curStore().set('divine-target', divineTarget); } catch (e2) {}
syncTargets();
});
}
}
window.divineRenderTargets = function (id) { try { renderTargetsInto(id); } catch (e) {} };
window.divineGetTarget = function () { return divineTarget; };
window.divineTargetName = function (cid) { return targetName(cid); };
function writeHomeRec(cid, record) {
let list = [];
try { list = JSON.parse(window.storeFor(cid).get('records-divine') || '[]'); } catch (e) { list = []; }
if (!Array.isArray(list)) list = [];
if (!list.some(x => x && x.ts === record.ts)) list.unshift(record);
if (list.length > 100) list = list.slice(0, 100);
try { window.storeFor(cid).set('records-divine', JSON.stringify(list)); } catch (e) {}
}
function saveToHome(record, target) {
if (!target) return;
if (!histReady) { homePending.push({ cid: target, record: record }); return; }
writeHomeRec(target, record);
}
function flushHomePending() {
if (!homePending.length) return;
const arr = homePending; homePending = [];
arr.forEach(p => { try { writeHomeRec(p.cid, p.record); } catch (e) {} });
}
window.divineSaveToHomeHistory = function (record, target) { try { saveToHome(record, target); } catch (e) {} };
function faceActive(c) {
if (!isFaceKey(c.icon)) return false;
const p = faceParse(c.icon);
return !!faceThb.get(p.m + '|' + p.n);
}
function faceTouch(c, m) {
if (faceActive(c)) {
const p = faceParse(c.icon);
const thb = faceThb.get(p.m + '|' + p.n);
return '<div class="div-card-img"><img src="' + thb + '" alt=""></div>';
}
if (isFaceKey(c.icon)) {
const p = faceParse(c.icon);
const im = iconMapOf(p.m);
return '<div class="div-card-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + (im[ORIG_ICON[p.m][p.n]] || '') + '</svg></div>';
}
const icons = m === 'tarot' ? TAROT_ICONS : LENO_ICONS;
return '<div class="div-card-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + (icons[c.icon] || '') + '</svg></div>';
}
const modesWrap = document.getElementById('div-modes');
const countsWrap = document.getElementById('div-counts');
if (modesWrap) {
modesWrap.addEventListener('click', (e) => {
const b = e.target.closest('.div-mode');
if (!b) return;
modesWrap.querySelectorAll('.div-mode').forEach(x => x.classList.remove('sel'));
b.classList.add('sel');
mode = b.dataset.mode;
syncLenoSys();
clearResult();
});
}
if (countsWrap) {
countsWrap.addEventListener('click', (e) => {
const b = e.target.closest('.div-mode');
if (!b) return;
countsWrap.querySelectorAll('.div-mode').forEach(x => x.classList.remove('sel'));
b.classList.add('sel');
count = Number(b.dataset.count);
clearResult();
});
}
function clearResult() {
if (window.__divActiveDraw) { try { window.__divActiveDraw(); } catch (e) {} window.__divActiveDraw = null; }
const r = document.getElementById('div-result');
if (r) r.innerHTML = '<div class="div-result-empty">点击上方按钮开始抽牌</div>';
}
function autoSendGet() { try { return store.get('divine-send-auto') === '1'; } catch (e) { return false; } }
function autoSendSet(on) { try { store.set('divine-send-auto', on ? '1' : '0'); } catch (e) {} }
function syncAutoToggle() {
const el = document.getElementById('div-auto-send');
if (el) el.checked = autoSendGet();
}
function startDivineDraw(stageEl, opts) {
const deck = shuf(opts.deck || []);
const count = Math.max(1, parseInt(opts.count, 10) || 1);
const labels = opts.labels || [];
const isTarot = !!opts.tarot;
const onDone = opts.onDone || function () {};
if (!stageEl || !deck.length) return function () {};
let cancelled = false;
const cancel = function () { cancelled = true; };
const results = [];
let remaining = deck.slice();
stageEl.innerHTML = '';
const box = document.createElement('div');
box.className = 'div-shuf-box';
stageEl.appendChild(box);
const shufCount = Math.min(remaining.length + 6, 20);
const shufCards = [];
const rnd = (a, b) => a + Math.random() * (b - a);
for (let i = 0; i < shufCount; i++) {
const el = document.createElement('div');
el.className = 'div-shuf-card';
const size = Math.round(rnd(46, 60));
const x = Math.round(rnd(-64, 64));
const y = Math.round(rnd(-30, 30));
const rot = Math.round(rnd(-32, 32));
el.style.width = size + 'px';
el.style.height = Math.round(size * 1.58) + 'px';
el.style.transform = 'translate(-50%,-50%) translate(' + x + 'px,' + y + 'px) rotate(' + rot + 'deg)';
el.style.opacity = (0.5 + Math.random() * 0.4).toFixed(2);
el.style.zIndex = shufCount - i;
box.appendChild(el);
shufCards.push(el);
}
requestAnimationFrame(function () {
shufCards.forEach(function (el, i) {
setTimeout(function () {
const px = Math.round(rnd(-76, 76));
const py = Math.round(rnd(-34, 34));
const pr = Math.round(rnd(-52, 52));
el.style.transform = 'translate(-50%,-50%) translate(' + px + 'px,' + py + 'px) rotate(' + pr + 'deg) scale(.92)';
el.style.opacity = (0.65 + Math.random() * 0.35).toFixed(2);
}, 50 + i * 50);
});
setTimeout(function () {
shufCards.forEach(function (el, i) {
const offX = Math.round((i - shufCount / 2) * 1.2);
const offY = Math.round((i - shufCount / 2) * 0.9);
el.style.transform = 'translate(-50%,-50%) translate(' + offX + 'px,' + offY + 'px) rotate(0deg) scale(1)';
el.style.opacity = '0.95';
el.style.zIndex = shufCount - i;
});
}, 950);
});
setTimeout(function () {
if (cancelled) return;
box.remove();
const hint = document.createElement('div');
hint.className = 'div-pile-hint';
stageEl.appendChild(hint);
const drawnRow = document.createElement('div');
drawnRow.className = 'div-drawn-row';
stageEl.appendChild(drawnRow);
const row1 = document.createElement('div'); row1.className = 'div-card-row';
const row2 = document.createElement('div'); row2.className = 'div-card-row';
stageEl.appendChild(row1); stageEl.appendChild(row2);
const updateHint = function () {
if (cancelled) return;
if (!remaining.length) hint.textContent = '牌库已空';
else hint.textContent = '左右滑动牌面 · 点击牌背抽取 · 剩 ' + remaining.length + ' 张 · 已抽 ' + results.length + ' / ' + count + ' 张';
};
const renderGrid = function () {
row1.innerHTML = ''; row2.innerHTML = '';
const total = remaining.length;
if (!total) { updateHint(); return; }
const half = Math.ceil(total / 2);
for (let i = 0; i < total; i++) {
const el = document.createElement('div');
el.className = 'div-pile-card';
el.addEventListener('click', function () { pick(i); });
(i < half ? row1 : row2).appendChild(el);
}
updateHint();
};
const pick = function (idx) {
if (cancelled) return;
if (idx < 0 || idx >= remaining.length) return;
if (results.length >= count) return;
const c = remaining[idx];
remaining = remaining.slice(0, idx).concat(remaining.slice(idx + 1));
let rev = false, meaning = c.meaning;
if (isTarot) { rev = Math.random() > 0.5; meaning = rev ? c.neg : c.pos; }
results.push({ name: c.name, icon: c.icon, rev: rev, meaning: meaning, detail: c.detail || '' });
renderGrid();
const dc = document.createElement('div');
dc.className = 'div-drawn-card';
dc.innerHTML =
'<div class="ddc-face' + (faceActive(c) ? ' has-face' : '') + '">' +
faceTouch(c, isTarot ? 'tarot' : 'lenormand') +
'<div class="ddc-name">' + c.name + '</div>' +
(isTarot ? '<div class="ddc-pos' + (rev ? ' ddc-down' : ' ddc-up') + '">' + (rev ? '逆位' : '正位') + '</div>' : '') +
'</div>' +
(labels[results.length - 1] ? '<div class="ddc-label">' + labels[results.length - 1] + '</div>' : '');
drawnRow.appendChild(dc);
if (results.length >= count || !remaining.length) {
setTimeout(function () { if (!cancelled) onDone(results); }, 550);
}
};
renderGrid();
}, 1750);
return cancel;
}
function shuf(a) {
const b = a.slice();
for (let i = b.length - 1; i > 0; i--) {
const j = Math.floor(Math.random() * (i + 1));
const t = b[i]; b[i] = b[j]; b[j] = t;
}
return b;
}
function partnerName2() {
const n = storeName();
return n ? n : '';
}
function storeName() {
try { return store.get('lbl-partner') || store.get('cs-lbl-partner') || ''; } catch (e) { return ''; }
}
function buildSummary(cards, mode, question) {
let line = '';
if (mode === 'tarot') {
const revCount = cards.filter(c => c.rev).length;
const posCount = cards.length - revCount;
if (revCount === 0) line = '牌面全数正位，气运正盛。近期的选择与努力大多会得到回报，可以大胆前行。';
else if (posCount === 0) line = '牌面全数逆位，眼下更需要稳住心神。放缓节奏、少做重大决定，等迷雾散去再做打算。';
else if (posCount > revCount) line = '牌面整体偏正，虽有波折但大势向好。把握核心目标，好运正在靠近。';
else line = '牌面正逆交织，前路有起伏。越是这种时候，越要回到自己的节奏里，稳稳走好每一步。';
} else {
line = cards.map(c => '「' + c.name + '」' + c.meaning).join(' ');
}
if (question) {
line += '就你问的「' + question + '」：' + (mode === 'tarot'
? '顺着牌面的大势走，答案会在合适的时候到来。'
: '保持开放的心态，答案往往在行动中显现。');
}
return line;
}
let histReady = false;
let histPending = null;
let histPendingCid = null;
function histLoad() {
let list = [];
try { list = JSON.parse(store.get('divine-history') || '[]'); } catch (e) { list = []; }
return Array.isArray(list) ? list : [];
}
function histSave(list) {
const data = JSON.stringify(list);
if (!histReady) {
try { histPending = Array.isArray(list) ? list.slice() : []; histPendingCid = window.__activeCid || 'default'; } catch (e) {}
return;
}
try { store.set('divine-history', data); } catch (e) {}
}
function migrateLegacyHist() {
if ((window.__activeCid || 'default') !== 'default') return;
try {
if (window.storeFor('default').get('divine-history')) return;
const raw = localStorage.getItem('divine-history');
if (!raw) return;
const arr = JSON.parse(raw);
if (Array.isArray(arr) && arr.length) {
window.storeFor('default').set('divine-history', JSON.stringify(arr));
try { localStorage.removeItem('divine-history'); } catch (e) {}
try { renderHistory(); } catch (e) {}
}
} catch (e) {}
}
function flushPendingHist() {
if (!histPending) return;
const pending = histPending;
const pendingCid = histPendingCid || (window.__activeCid || 'default');
histPending = null;
histPendingCid = null;
if (!pending.length) return;
const targetStore = window.storeFor(pendingCid);
const targetPrefix = 'xy-home-v2:' + pendingCid;
const finish = (base) => {
try { targetStore.set('divine-history', JSON.stringify(base)); } catch (e) {}
try { if ((window.__activeCid || 'default') === pendingCid) renderHistory(); } catch (e) {}
};
const merge = (base) => {
const have = {};
base.forEach(x => { if (x && x.ts !== undefined) have[x.ts] = true; });
pending.forEach(x => { if (x && x.ts !== undefined && !have[x.ts]) { base.push(x); have[x.ts] = true; } });
finish(base);
};
if (window.idbGet) {
window.idbGet(targetPrefix + ':divine-history').then(v => {
let base = [];
try { const p = typeof v === 'string' ? JSON.parse(v) : v; if (Array.isArray(p)) base = p; } catch (e) {}
merge(base);
}).catch(() => merge([]));
} else {
merge([]);
}
}
function onDivRestore() {
histReady = true;
migrateLegacyHist();
flushPendingHist();
try { flushHomePending(); } catch (e) {}
try { renderHistory(); } catch (e) {}
}
try {
if (window.__mochiDataReady) onDivRestore();
else document.addEventListener('mochi-restore-done', onDivRestore);
} catch (e) {}
function fmtDT(ts) {
const d = new Date(ts);
const p = (n) => (n < 10 ? '0' + n : '' + n);
return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function renderHistory() {
const el = document.getElementById('div-history');
if (!el) return;
const list = histLoad();
el.innerHTML = list.length
? '<div class="div-label">占卜记录</div>' + list.map((h, i) =>
'<div class="div-h-item" data-hi="' + i + '">' +
'<div class="div-h-main"><div class="div-h-title">' + (h.mode === 'tarot' ? '塔罗' : '雷诺曼') + ' · ' + h.count + ' 张' +
(h.question ? ' · 问：' + String(h.question).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') : '') + '</div>' +
'<div class="div-h-sub">' + fmtDT(h.ts) + ' · ' + (Array.isArray(h.cards) ? h.cards.map(c => ((c && c.name) || '') + (c && c.rev ? '(逆)' : '')).join('、') : '') + '</div></div>' +
'<button class="div-h-view" data-hi="' + i + '">查看</button>' +
'<button class="div-h-del" data-hi="' + i + '">✕</button>' +
'</div>').join('')
: '';
const hcard = el.closest ? el.closest('.div-card') : null;
if (hcard) hcard.hidden = !list.length;
el.querySelectorAll('.div-h-view').forEach(b => b.addEventListener('click', () => {
const h = histLoad()[parseInt(b.dataset.hi, 10)];
if (h && Array.isArray(h.cards)) renderDrawResult(h.cards, h.mode, h.question, h.summary);
}));
el.querySelectorAll('.div-h-del').forEach(b => b.addEventListener('click', () => {
const list = histLoad();
list.splice(parseInt(b.dataset.hi, 10), 1);
histSave(list);
renderHistory();
}));
}
function renderDrawResult(cards, m, question, summary) {
const r = document.getElementById('div-result');
if (!r) return;
const labels = (MODE_LABELS[m] && MODE_LABELS[m][cards.length]) || [];
let html = '<div class="div-spread">';
cards.forEach((c, i) => {
html += '<div class="div-mini' + (cards.length === 1 ? ' div-mini-single' : '') + '" style="animation-delay:' + (i * 120) + 'ms">' +
(labels[i] ? '<div class="div-mini-tag">' + labels[i] + '</div>' : '') +
'<div class="div-card-face' + (faceActive(c) ? ' has-face' : '') + '">' +
faceTouch(c, m) +
'<div class="div-card-name">' + (c.rev ? c.name + '（逆）' : c.name) + '</div>' +
'</div>' +
'<div class="div-card-meaning">' + (window.taFit ? window.taFit(c.meaning) : c.meaning) + '</div>' +
'</div>';
});
html += '</div>';
html += '<div class="div-summary">' + (window.taFit ? window.taFit(summary) : summary) + '</div>';
if (question) html += '<div class="div-question-q">问：' + String(question).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') + '</div>';
html += '<div class="div-result-actions">';
html += '<button class="div-send-btn" id="div-send-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;vertical-align:-3px;margin-right:6px"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>发给 ' + (partnerName2() || (window.taWord ? window.taWord() : 'TA')) + '</button>';
html += '<button class="div-copy-btn" id="div-copy-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;vertical-align:-3px;margin-right:6px"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>点击复制文字</button>';
html += '</div>';
r.innerHTML = html;
const sendBtn = document.getElementById('div-send-btn');
if (sendBtn) sendBtn.addEventListener('click', () => sendToChat(m, cards, summary, question));
const copyBtn = document.getElementById('div-copy-btn');
if (copyBtn) copyBtn.addEventListener('click', () => copyResultText(buildResultText(m, cards, summary, question)));
}
function buildResultText(m, cards, summary, question) {
const modeTxt = m === 'tarot' ? '塔罗' : '雷诺曼';
let text = '占卜 · ' + modeTxt + ' ' + cards.length + ' 张';
if (question) text += '（问：' + question + '）';
text += '\n';
const labels = (MODE_LABELS[m] && MODE_LABELS[m][cards.length]) || [];
cards.forEach((c, i) => {
text += (i + 1) + '. ' + (labels[i] || ('位置' + (i + 1))) + ' · ' + c.name + (c.rev ? '（逆）' : '') + '：' + c.meaning + '\n';
});
text += '综合：' + String(summary || '').replace(/^综合[:：]/, '');
return text;
}
function copyResultText(text) {
if (navigator.clipboard && navigator.clipboard.writeText) {
navigator.clipboard.writeText(text).then(() => toast('已复制到剪贴板')).catch(() => copyFallback(text));
} else {
copyFallback(text);
}
}
function copyFallback(text) {
const ta = document.createElement('textarea');
ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
document.body.appendChild(ta); ta.select();
try { document.execCommand('copy'); toast('已复制到剪贴板'); } catch (e) { toast('复制失败，请长按手动复制'); }
document.body.removeChild(ta);
}
function sendToChat(m, cards, summary, question) {
const text = buildResultText(m, cards, summary, question);
if (window.chatSendMsg) { window.chatSendMsg(text); toast('已发送给 ' + (partnerName2() || 'TA')); }
else toast('请先进入聊天页');
}
function sendToChat(m, cards, summary, question) {
const modeTxt = m === 'tarot' ? '塔罗' : '雷诺曼';
let text = '占卜 · ' + modeTxt + ' ' + cards.length + ' 张';
if (question) text += '（问：' + question + '）';
text += '\n';
cards.forEach((c, i) => {
const labels = (MODE_LABELS[m] && MODE_LABELS[m][cards.length]) || [];
text += (i + 1) + '. ' + (labels[i] || ('位置' + (i + 1))) + ' · ' + c.name + (c.rev ? '（逆）' : '') + '：' + c.meaning + '\n';
});
text += '综合：' + String(summary || '').replace(/^综合[:：]/, '');
if (window.chatSendMsg) { window.chatSendMsg(text); toast('已发送给 ' + (partnerName2() || 'TA')); }
else toast('请先进入聊天页');
}
function toast(msg) {
let t = document.getElementById('cc-toast');
if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
t.textContent = msg;
t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
clearTimeout(t._timer);
t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2000);
}
const drawBtn = document.getElementById('div-draw');
const drawBtnIdleHTML = drawBtn ? drawBtn.innerHTML : '';
if (drawBtn) {
drawBtn.addEventListener('click', () => {
const r = document.getElementById('div-result');
if (!r) return;
if (drawBtn.textContent.indexOf('重新抽牌') !== -1) {
if (window.__divActiveDraw) { try { window.__divActiveDraw(); } catch (e) {} window.__divActiveDraw = null; }
clearResult();
drawBtn.innerHTML = drawBtnIdleHTML;
return;
}
if (window.__divActiveDraw) { try { window.__divActiveDraw(); } catch (e) {} window.__divActiveDraw = null; }
const question = ((document.getElementById('div-question') || {}).value || '').trim();
const snapMode = mode, snapCount = count;
const deck = snapMode === 'tarot' ? TAROT : lenoDeck();
if (!deck.length) { r.innerHTML = '<div class="div-result-empty">占卜牌库加载中…</div>'; return; }
const labels = (MODE_LABELS[snapMode] && MODE_LABELS[snapMode][snapCount]) || [];
drawBtn.textContent = '抽牌中…';
window.__divActiveDraw = startDivineDraw(r, {
deck: deck,
count: snapCount,
labels: labels,
tarot: snapMode === 'tarot',
onDone: (cards) => {
window.__divActiveDraw = null;
drawBtn.textContent = '重新抽牌';
const summary = buildSummary(cards, snapMode, question);
renderDrawResult(cards, snapMode, question, summary);
const snapTarget = divineTarget; // v3.27.x：快照点击时的占卜对象
const record = { ts: Date.now(), mode: snapMode, count: snapCount, question: question, cards: cards, summary: summary };
if (snapTarget) record.target = targetName(snapTarget);
const list = histLoad();
list.unshift(record);
histSave(list);
renderHistory();
try { saveToHome(record, snapTarget); } catch (e) {}
if (autoSendGet()) {
const myCid = window.__activeCid || 'default';
setTimeout(() => { if ((window.__activeCid || 'default') !== myCid) return; sendToChat(snapMode, cards, summary, question); }, 500);
}
}
});
});
}
const divApp = document.querySelector('.app[data-app="divination"]');
if (divApp && page) {
divApp.addEventListener('click', (e) => {
const editing = Array.from(document.querySelectorAll('.app-grid')).some(g => g.classList.contains('editing'));
if (editing) {
const grid = divApp.closest('.app-grid');
if (grid && grid.classList.contains('editing')) return;
if (window.openIconMenu) { e.stopPropagation(); window.openIconMenu(divApp); }
return;
}
document.querySelectorAll('.page').forEach(p => p.hidden = true);
page.hidden = false;
renderHistOnOpen();
});
}
const divBack = document.getElementById('div-back');
if (divBack) {
divBack.addEventListener('click', () => {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const phonePage = document.getElementById('page-phone');
if (phonePage) phonePage.hidden = false;
});
}
function renderHistOnOpen() {
try { renderHistory(); } catch (e) {}
try { syncAutoToggle(); } catch (e) {}
try { renderTargetsInto('div-targets'); } catch (e) {}
}
renderHistOnOpen();
document.addEventListener('contact-switched', renderHistOnOpen);
const autoEl = document.getElementById('div-auto-send');
if (autoEl) autoEl.addEventListener('change', () => { autoSendSet(autoEl.checked); });
document.querySelectorAll('#page-divine .dec-inp-clear').forEach(btn => {
btn.addEventListener('click', () => {
const ta = document.getElementById(btn.dataset.clear);
if (!ta) return;
const box = ta.__ceBox;
if (box) box.textContent = '';
else ta.value = '';
ta.focus();
toast('已清空');
});
});
function facePanelHTML() {
return '' +
'<div class="chat-head">' +
'<span class="ch-back" id="divf-back"><svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></span>' +
'<span class="ch-name">牌面图鉴</span>' +
'</div>' +
'<div class="divf-tabs">' +
'<button class="divf-tab sel" data-fpanel="manage">牌面管理</button>' +
'<button class="divf-tab" data-fpanel="gallery">我的图鉴</button>' +
'</div>' +
'<div class="divf-tools">' +
'<button class="divf-batch-btn" id="divf-batch">📂 批量上传（按文件名自动对应牌）</button>' +
'<button class="divf-batch-btn" id="divf-onebased" style="margin-top:6px">编号从 1 起（塔罗 1–78）：关</button>' +
'<div class="divf-hint">按文件名自动对应牌：<br>' +
'· 牌名：<b>愚人.png</b>、<b>权杖王牌.jpg</b>（含子串也行，如 塔罗牌-愚人.png）<br>' +
'· 数字牌名：<b>宝剑1.png</b>、<b>圣杯10.jpg</b>、<b>权杖A.png</b>（＝宝剑王牌／宝剑一…宝剑十、王牌，1–10 与 A 都认）<br>' +
'· 体系前缀：<b>塔罗-愚人.png</b>、<b>雷诺曼-骑士.jpg</b>、<b>tarot-00-魔术师.png</b><br>' +
'· 前缀序号：<b>07-战车.png</b><br>' +
'· 纯编号：塔罗 <b>00–77</b>、雷诺曼 <b>1–36/40</b>（同名跨体系按当前页签；塔罗编号从 0 起，如你的素材从 1 开始请开下方「编号从 1 起」）<br>' +
'未识别的文件会列出来，其余照常导入。</div>' +
'<div class="divf-hint" id="divf-batch-hint">选不了多张或点了没反应，是浏览器 / 所在 App 的限制：换 Chrome / Edge 再试（详见 使用说明第 13 节）</div>' +
'</div>' +
'<div class="divf-scroll">' +
'<div data-fpanel-body="manage">' +
'<div class="divf-modes" id="divf-modes">' +
'<button class="divf-mode sel" data-fmode="tarot">塔罗 78</button>' +
'<button class="divf-mode" data-fmode="lenormand">雷诺曼</button>' +
'</div>' +
'<div id="divf-list"></div>' +
'</div>' +
'<div data-fpanel-body="gallery" hidden>' +
'<div class="divf-gal-bar"><span id="divf-gal-count"></span><button class="divf-mini" id="divf-clear">清空全部</button></div>' +
'<div class="divf-grid" id="divf-grid"></div>' +
'</div>' +
'<div class="divf-io">' +
'<button class="divf-io-btn" id="divf-export">导出数据</button>' +
'<button class="divf-io-btn" id="divf-import">导入数据</button>' +
'</div>' +
'</div>';
}
function initFaceUI() {
const head = document.querySelector('#page-divine .chat-head');
if (head && !document.getElementById('div-faces-btn')) {
const btn = document.createElement('button');
btn.className = 'ch-more';
btn.id = 'div-faces-btn';
btn.title = '牌面图鉴';
btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>';
head.appendChild(btn);
btn.addEventListener('click', openFacePanel);
}
const setup = document.querySelector('#page-divine .div-setup');
if (setup && !document.getElementById('div-leno-sys')) {
const wrap = document.createElement('div');
wrap.className = 'div-modes div-leno-sys';
wrap.id = 'div-leno-sys';
wrap.hidden = true;
wrap.innerHTML = '<button class="div-mode" data-lenosys="36">36 张 · 经典</button><button class="div-mode" data-lenosys="40">40 张 · 含扩展</button>';
setup.appendChild(wrap);
wrap.addEventListener('click', (e) => {
const b = e.target.closest('.div-mode');
if (!b) return;
leno36 = b.dataset.lenosys === '36';
try { gStore.set(LENO36_KEY, leno36 ? '1' : '0'); } catch (e2) {}
syncLenoSys();
clearResult();
});
}
if (!document.getElementById('divf-page')) {
const pg = document.createElement('div');
pg.className = 'divf-page';
pg.id = 'divf-page';
pg.hidden = true;
pg.innerHTML = facePanelHTML();
const host = document.getElementById('page-divine') || document.body;
host.appendChild(pg);
wireFacePanel(pg);
}
injectChatFacesUI();
syncLenoSys();
}
function injectChatFacesUI() {
const body = document.getElementById('chat-divine-body');
if (!body || document.getElementById('div-chat-faces-btn')) return;
const lenoWrap = document.createElement('div');
lenoWrap.className = 'div-modes-wrap div-leno-sys';
lenoWrap.id = 'div-chat-leno-sys';
lenoWrap.hidden = true;
lenoWrap.innerHTML = '<span class="div-mode" data-lenosys="36">36 张 · 经典</span><span class="div-mode" data-lenosys="40">40 张 · 含扩展</span>';
const modeWrap = body.querySelector('.div-modes-wrap');
if (modeWrap && modeWrap.parentNode === body) modeWrap.insertAdjacentElement('afterend', lenoWrap);
else body.insertBefore(lenoWrap, body.firstChild);
lenoWrap.addEventListener('click', (e) => {
const b = e.target.closest('.div-mode');
if (!b || !b.dataset.lenosys) return;
leno36 = b.dataset.lenosys === '36';
try { gStore.set(LENO36_KEY, leno36 ? '1' : '0'); } catch (e2) {}
syncLenoSys();
});
const bar = document.createElement('div');
bar.className = 'div-chat-facesbar';
bar.innerHTML = '<button type="button" class="div-chat-faces-btn" id="div-chat-faces-btn">🖼 牌面图鉴</button>';
const targets = body.querySelector('#div-chat-targets');
if (targets && targets.parentNode === body) targets.insertAdjacentElement('afterend', bar);
else body.insertBefore(bar, body.firstChild);
const fb = bar.querySelector('#div-chat-faces-btn');
if (fb) fb.addEventListener('click', (e) => { e.stopPropagation(); openFacePanelFromAnywhere(); });
body.querySelectorAll('[data-chatmode]').forEach(b => b.addEventListener('click', () => setTimeout(syncLenoSys, 0)));
}
function openFacePanelFromAnywhere() {
const d = document.getElementById('page-divine');
if (d) {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
d.hidden = false;
}
openFacePanel();
}
function openFacePanel() {
const pg = document.getElementById('divf-page');
if (!pg) return;
const d = document.getElementById('page-divine');
if (d) { facePanelScroll = d.scrollTop || 0; d.classList.add('divf-lock'); try { d.scrollTop = 0; } catch (e) {} }
pg.hidden = false;
syncFaceTabs();
renderFaceList();
renderFaceGallery();
}
function closeFacePanel() {
const pg = document.getElementById('divf-page');
if (pg) pg.hidden = true;
const d = document.getElementById('page-divine');
if (d) { d.classList.remove('divf-lock'); try { d.scrollTop = facePanelScroll; } catch (e) {} }
try { renderHistOnOpen(); } catch (e) {}
}
function syncFaceTabs() {
const pg = document.getElementById('divf-page');
if (!pg) return;
pg.querySelectorAll('.divf-tab').forEach(b => b.classList.toggle('sel', b.dataset.fpanel === faceTab));
pg.querySelectorAll('[data-fpanel-body]').forEach(b => { b.hidden = b.getAttribute('data-fpanel-body') !== faceTab; });
pg.querySelectorAll('.divf-mode').forEach(b => b.classList.toggle('sel', b.dataset.fmode === facePanelCid));
}
function renderFaceList() {
const el = document.getElementById('divf-list');
if (!el) return;
const m = facePanelCid || 'tarot';
const arr = m === 'tarot' ? TAROT : LENO;
const imap = iconMapOf(m);
el.innerHTML = arr.map(c => {
const thb = faceThb.get(m + '|' + c.name) || '';
const prev = thb
? '<div class="divf-thb"><img src="' + thb + '" alt=""></div>'
: '<div class="divf-thb divf-thb-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + (imap[ORIG_ICON[m][c.name]] || '') + '</svg></div>';
return '<div class="divf-row" data-name="' + escHtml(c.name) + '">' + prev +
'<div class="divf-name">' + escHtml(c.name) + '</div>' +
'<button class="divf-act divf-up">' + (thb ? '更换' : '上传') + '</button>' +
(thb ? '<button class="divf-act divf-del">清除</button>' : '') +
'</div>';
}).join('');
}
function renderFaceGallery() {
const grid = document.getElementById('divf-grid');
if (!grid) return;
const idx = loadFaceIdx();
const cnt = document.getElementById('divf-gal-count');
if (cnt) cnt.textContent = idx.length ? ('已上传 ' + idx.length + ' 张牌面') : '';
grid.innerHTML = idx.length ? idx.map(x => {
const thb = faceThb.get(x.m + '|' + x.n) || '';
return '<div class="divf-cell" data-m="' + x.m + '" data-name="' + escHtml(x.n) + '">' +
'<div class="divf-cell-img">' + (thb ? '<img src="' + thb + '" alt="">' : '<span class="divf-missing">图缺失</span>') + '</div>' +
'<div class="divf-cell-name">' + escHtml(x.n) + '<span class="divf-cell-mode">' + (x.m === 'tarot' ? '塔罗' : '雷诺曼') + '</span></div>' +
'<div class="divf-cell-acts"><button class="divf-mini divf-cell-up">更换</button><button class="divf-mini divf-cell-del">删除</button></div>' +
'</div>';
}).join('') : ((window.mochiDataPending && window.mochiDataPending()) ? window.mochiLoadingHtml('牌面图') : '<div class="divf-empty">还没有上传牌面。到「牌面管理」给喜欢的牌换张图吧。</div>');
}
if (window.mochiOnDataReady) window.mochiOnDataReady(function () { try { renderFaceGallery(); } catch (e) {} });
function pickFaceFile(m, n) {
pendingUpload = { m: m, n: n };
window.mochiFilePick({
id: 'dev-divf-img-pick',
accept: 'image/*',
onFiles: (files) => {
const f = files && files[0];
if (!f || !pendingUpload) { pendingUpload = null; return; }
const target = pendingUpload;
pendingUpload = null;
const rd = new FileReader();
rd.onload = () => {
compressImg(rd.result, 720, 0.85).then((full) => {
if (!full) { toast('图片过大或无法读取，请换一张'); return; }
compressImg(rd.result, 200, 0.82).then((thb) => {
if (!thb) { toast('图片处理失败，请换一张'); return; }
storeFaceFromDataUrls(target.m, target.n, full, thb);
renderFaceList(); renderFaceGallery();
toast('已设为「' + target.n + '」的牌面');
});
});
};
rd.onerror = () => toast('图片读取失败');
rd.readAsDataURL(f);
}
});
}
function deleteFace(m, n) {
window.openModal('删除「' + n + '」的自定义牌面？', '', (v) => {
if (v !== 'ok') return;
rmFaceData(m, n);
saveFaceIdx(loadFaceIdx().filter(x => !(x.m === m && x.n === n)));
rebuildFaces();
renderFaceList(); renderFaceGallery();
toast('已删除「' + n + '」的牌面');
}, { noInput: true, pillSubmit: true, staticText: '删除后恢复为默认牌面。', pills: [{ label: '删除', value: 'ok' }] });
}
function clearAllFaces() {
const n = loadFaceIdx().length;
if (!n) { toast('还没有上传牌面'); return; }
window.openModal('清空全部 ' + n + ' 张自定义牌面？（不可恢复）', '', (v) => {
if (v !== 'ok') return;
loadFaceIdx().forEach(x => rmFaceData(x.m, x.n));
saveFaceIdx([]);
rebuildFaces();
renderFaceList(); renderFaceGallery();
toast('已清空全部自定义牌面');
}, { noInput: true, pillSubmit: true, staticText: '将删除所有已上传的牌面图片。', pills: [{ label: '清空', value: 'ok' }] });
}
function buildFaceExport() {
const idx = loadFaceIdx();
if (!idx.length) return Promise.resolve('');
const readFull = (k) => {
const fallback = () => { try { return gStore.get(k) || ''; } catch (e) { return ''; } };
if (!window.idbGet) return Promise.resolve(fallback());
return Promise.resolve(window.idbGet(GNS + ':' + k)).then(v => (typeof v === 'string' && v) ? v : fallback()).catch(fallback);
};
return idx.reduce((p, x) => p.then(faces => readFull(fullKey(x.m, x.n)).then(img => {
faces.push({
m: x.m, n: x.n,
img: img || faceThb.get(x.m + '|' + x.n) || '',
thb: faceThb.get(x.m + '|' + x.n) || ''
});
return faces;
})), Promise.resolve([])).then(faces => JSON.stringify({
v: 1, type: 'mochi-divine-faces', ts: Date.now(),
leno36: leno36 ? 1 : 0,
oneBased: faceOneBased ? 1 : 0,
faces: faces.filter(f => f.img || f.thb)
}));
}
function exportFacesData() {
if (!loadFaceIdx().length) { toast('还没有上传牌面'); return; }
toast('正在打包牌面数据…');
buildFaceExport().then(json => {
if (!json) { toast('还没有上传牌面'); return; }
const fname = 'mochi-divine-faces-' + dtStamp() + '.json';
if (window.mochiExportFile) { window.mochiExportFile(json, fname, '导出占卜牌面数据'); return; }
try {
const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url; a.download = fname;
document.body.appendChild(a); a.click(); document.body.removeChild(a);
setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 4000);
} catch (e) { toast('导出失败，请换系统浏览器重试'); }
}).catch(() => toast('导出失败，请重试'));
}
function importFacesData(data) {
if (!data || data.type !== 'mochi-divine-faces' || !Array.isArray(data.faces)) { toast('文件格式不正确，请选择导出的牌面 JSON'); return; }
const valid = data.faces.filter(x => x && (x.m === 'tarot' || x.m === 'lenormand') && x.n && cardOf(x.m, x.n) &&
typeof (x.img || x.thb) === 'string' && (x.img || x.thb));
if (!valid.length) { toast('文件里没有可导入的牌面'); return; }
window.openModal('导入 ' + valid.length + ' 张牌面', '', (v) => {
if (!v) return;
toast('正在导入 ' + valid.length + ' 张牌面…');
requestAnimationFrame(() => setTimeout(() => {
applyImport(valid, v === 'replace', data.leno36, data.oneBased);
}, 0));
}, { noInput: true, pillSubmit: true, pill: 'merge', staticText: '「合并」保留现有牌面并覆盖同名；「覆盖」先清空现有牌面再导入。', pills: [{ label: '合并导入', value: 'merge' }, { label: '覆盖导入', value: 'replace' }] });
}
function applyImport(list, replace, l36, oneB) {
if (replace) { loadFaceIdx().forEach(x => rmFaceData(x.m, x.n)); }
const idx = replace ? [] : loadFaceIdx();
const byKey = {};
idx.forEach(x => { byKey[x.m + '|' + x.n] = true; });
let ok = 0;
list.forEach(x => {
const full = String(x.img || x.thb || '');
const thb = String(x.thb || x.img || '');
if (!full || full.length > 8 * 1024 * 1024) return;
try { gStore.set(fullKey(x.m, x.n), full); } catch (e) {}
try { gStore.set(thbKey(x.m, x.n), thb); } catch (e) {}
faceThb.set(x.m + '|' + x.n, thb);
if (!byKey[x.m + '|' + x.n]) { idx.push({ m: x.m, n: x.n, t: Date.now() }); byKey[x.m + '|' + x.n] = true; }
ok++;
});
saveFaceIdx(idx);
if (l36 === 0 || l36 === 1) {
leno36 = l36 === 1;
try { gStore.set(LENO36_KEY, leno36 ? '1' : '0'); } catch (e) {}
syncLenoSys();
}
if (oneB === 0 || oneB === 1) {
faceOneBased = oneB === 1;
try { gStore.set(ONEBASED_KEY, faceOneBased ? '1' : '0'); } catch (e) {}
obBtn_sync();
}
rebuildFaces();
renderFaceList(); renderFaceGallery();
toast('已导入 ' + ok + ' 张牌面');
}
function handleBatchFiles(files) {
const list = Array.prototype.slice.call(files || []);
if (!list.length) return;
const defaultMode = facePanelCid || 'tarot';
const oneBased = faceOneBased;
const skipped = [];
const doneSet = new Set();
const existing = new Set(loadFaceIdx().map(x => x.m + '|' + x.n));
const overwritten = new Set();
const step = (i) => {
if (i >= list.length) {
renderFaceList(); renderFaceGallery();
if (doneSet.size) {
const ow = overwritten.size ? '，覆盖同名 ' + overwritten.size + ' 张' : '';
toast('批量导入 ' + doneSet.size + ' 张牌面' + ow + (skipped.length ? '，跳过 ' + skipped.length + ' 个' : ''));
}
else toast('没识别到对应牌（文件名需含牌名或编号）');
if (skipped.length && window.openModal) {
const names = skipped.slice(0, 15).join('、') + (skipped.length > 15 ? ' 等' : '');
window.openModal('以下 ' + skipped.length + ' 个文件没识别到对应牌', '', function () {}, { noInput: true, pillSubmit: true, big: true, staticText: names, pills: [{ label: '知道了', value: 'ok' }] });
}
return;
}
const f = list[i];
const hit = matchFaceFile(f.name, defaultMode, oneBased);
if (!hit) { skipped.push(f.name); step(i + 1); return; }
const rd = new FileReader();
rd.onload = () => {
compressImg(rd.result, 720, 0.85).then((full) => {
if (!full) { skipped.push(f.name); step(i + 1); return; }
compressImg(rd.result, 200, 0.82).then((thb) => {
if (!thb) { skipped.push(f.name); step(i + 1); return; }
storeFaceFromDataUrls(hit.m, hit.n, full, thb);
const key = hit.m + '|' + hit.n;
if (existing.has(key) || doneSet.has(key)) overwritten.add(key);
doneSet.add(key);
step(i + 1);
});
});
};
rd.onerror = () => { skipped.push(f.name); step(i + 1); };
rd.readAsDataURL(f);
};
step(0);
}
function wireFacePanel(pg) {
const back = pg.querySelector('#divf-back');
if (back) back.addEventListener('click', closeFacePanel);
pg.querySelectorAll('.divf-tab').forEach(b => b.addEventListener('click', () => {
faceTab = b.dataset.fpanel;
syncFaceTabs();
if (faceTab === 'gallery') renderFaceGallery(); else renderFaceList();
}));
const modes = pg.querySelector('#divf-modes');
if (modes) modes.addEventListener('click', (e) => {
const b = e.target.closest('.divf-mode');
if (!b) return;
facePanelCid = b.dataset.fmode;
syncFaceTabs();
renderFaceList();
});
const list = pg.querySelector('#divf-list');
if (list) list.addEventListener('click', (e) => {
const row = e.target.closest('.divf-row');
if (!row) return;
const n = row.dataset.name;
if (e.target.closest('.divf-del')) deleteFace(facePanelCid, n);
else if (e.target.closest('.divf-up')) pickFaceFile(facePanelCid, n);
});
const grid = pg.querySelector('#divf-grid');
if (grid) grid.addEventListener('click', (e) => {
const cell = e.target.closest('.divf-cell');
if (!cell) return;
const m = cell.dataset.m, n = cell.dataset.name;
if (e.target.closest('.divf-cell-del')) deleteFace(m, n);
else if (e.target.closest('.divf-cell-up')) pickFaceFile(m, n);
});
const clr = pg.querySelector('#divf-clear');
if (clr) clr.addEventListener('click', clearAllFaces);
const ex = pg.querySelector('#divf-export');
if (ex) ex.addEventListener('click', exportFacesData);
const imp = pg.querySelector('#divf-import');
if (imp) imp.addEventListener('click', () => {
window.mochiFilePick({
id: 'dev-divf-json-pick',
accept: '.json,application/json',
onFiles: (files) => {
const f = files && files[0];
if (!f) return;
const rd = new FileReader();
toast('正在读取牌面文件…');
rd.onload = () => {
toast('正在解析牌面数据…');
requestAnimationFrame(() => setTimeout(() => {
let d = null;
try { d = JSON.parse(String(rd.result || '')); } catch (e) { toast('文件解析失败，请选择导出的牌面 JSON'); return; }
importFacesData(d);
}, 0));
};
rd.onerror = () => toast('文件读取失败');
rd.onabort = () => toast('已取消读取牌面文件');
rd.readAsText(f);
}
});
});
const batchBtn = pg.querySelector('#divf-batch');
if (batchBtn) batchBtn.addEventListener('click', () => {
window.mochiFilePick({
id: 'dev-divf-batch-pick',
accept: 'image/*',
multiple: true,
onFiles: (arr) => { if (arr && arr.length) handleBatchFiles(arr); }
});
});
const obBtn = pg.querySelector('#divf-onebased');
obBtn_sync();
if (obBtn) obBtn.addEventListener('click', () => {
faceOneBased = !faceOneBased;
try { gStore.set(ONEBASED_KEY, faceOneBased ? '1' : '0'); } catch (e) {}
obBtn_sync();
toast(faceOneBased ? '已开启：塔罗纯编号按 1–78 对应' : '已关闭：塔罗纯编号按 0–77 对应');
});
}
try { initFaceUI(); } catch (e) {}
try { loadFaces(); } catch (e) {}
try {
document.addEventListener('mochi-restore-done', function () {
try { faceOneBased = gStore.get(ONEBASED_KEY) === '1'; obBtn_sync(); } catch (e) {}
try { loadFaces(); } catch (e) {}
});
} catch (e) {}
window.startDivineDraw = startDivineDraw;
window.divineHistLoad = histLoad;
window.divineHistSave = histSave;
window.divineAutoGet = autoSendGet;
window.divineAutoSet = autoSendSet;
window.divineBuildSummary = buildSummary;
window.divineBuildResultText = buildResultText;
window.divineCopyResultText = copyResultText;
window.divineSendResult = function (m, cards, summary, question) { sendToChat(m, cards, summary, question); };
window.divineRenderResult = function (cards, m, question, summary) {
try { renderDrawResult(cards, m, question, summary); } catch (e) {}
};
window.divineFaces = {
exportJSON: buildFaceExport,
importData: importFacesData,
count: function () { return loadFaceIdx().length; },
leno36: function () { return leno36; },
matchName: matchFaceFile
};
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("divination.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("divination.js"); try { console.error("[JS] divination.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[divination.js] " + String(__e && __e.message || __e)); } })();