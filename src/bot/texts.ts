// Reply texts for every language and tone. Copied from the approved chat mockup.
// This file is plain data and small template functions, so strict type checking is switched off for it.
// @ts-nocheck
export const LABEL = {
  deposit_how:{en:'how to deposit',ms:'cara deposit',zh:'如何存款'}, deposit_time:{en:'deposit time',ms:'masa deposit masuk',zh:'存款到账时间'},
  deposit_limit:{en:'deposit limits',ms:'had deposit',zh:'存款限额'}, withdraw_how:{en:'how to withdraw',ms:'cara pengeluaran',zh:'如何提款'},
  withdraw_time:{en:'withdrawal time',ms:'masa pengeluaran',zh:'提款到账时间'}, withdraw_limit:{en:'withdrawal limits',ms:'had pengeluaran',zh:'提款限额'},
  forgot_password:{en:'forgot password',ms:'lupa kata laluan',zh:'忘记密码'}, verify_account:{en:'account verification',ms:'pengesahan akaun',zh:'账号验证'},
  change_bank:{en:'changing bank account',ms:'tukar akaun bank',zh:'更改银行账户'}, contact_hours:{en:'service hours',ms:'waktu operasi',zh:'客服时间'},
  promo_bonus:{en:'promotions',ms:'promosi',zh:'优惠活动'},
  turnover_how:{en:'turnover requirement',ms:'syarat turnover',zh:'流水要求'}, transfer_fee:{en:'transfer fees',ms:'yuran pindahan',zh:'转账手续费'},
  refund_how:{en:'refunds',ms:'bayaran balik',zh:'退款'}, register_how:{en:'how to register',ms:'cara daftar',zh:'如何注册'}
};
export const TONE = {
  friendly:{pre:{en:'Hi! ',ms:'Hai! ',zh:'您好！'},post:{en:' Anything else I can help with? 😊',ms:' Ada apa-apa lagi yang boleh saya bantu? 😊',zh:' 还有其他需要帮忙的吗？😊'}},
  formal:{pre:{en:'Thank you for contacting us. ',ms:'Terima kasih kerana menghubungi kami. ',zh:'感谢您联系我们。'},post:{en:' Is there anything else we may assist you with?',ms:' Adakah terdapat apa-apa lagi yang boleh kami bantu?',zh:' 请问还有其他可以为您效劳的吗？'}}
};
export const CLARIFY_TXT = {
  en:(a,b)=>`Sorry, I want to make sure I help correctly. Are you asking about ${a} or ${b}?`,
  ms:(a,b)=>`Maaf, saya mahu pastikan saya membantu dengan betul. Adakah anda bertanya tentang ${a} atau ${b}?`,
  zh:(a,b)=>`抱歉，我想确认一下，您是想咨询${a}还是${b}？`
};
export const GREET = {
  en:n=>`Hi, I'm the AI assistant of ${n}. Ask me about deposits, withdrawals, your account or promotions.`,
  ms:n=>`Hai, saya pembantu AI ${n}. Tanya saya tentang deposit, pengeluaran, akaun atau promosi.`,
  zh:n=>`您好，我是${n}的AI助手。可以问我存款、提款、账号或优惠方面的问题。`
};
export const fmtAmt=n=>'RM'+Number(n).toLocaleString('en-US');
export const TOPIC_LABEL={turnover:{en:'turnover',ms:'turnover',zh:'流水'},transfer:{en:'transfers',ms:'pindahan',zh:'转账'},refund:{en:'refunds',ms:'bayaran balik',zh:'退款'},register:{en:'registration',ms:'pendaftaran',zh:'注册'},deposit:{en:'deposits',ms:'deposit',zh:'存款'},withdraw:{en:'withdrawals',ms:'pengeluaran',zh:'提款'},password:{en:'your password',ms:'kata laluan',zh:'密码'},verify:{en:'verification',ms:'pengesahan akaun',zh:'账号验证'},customer_service:{en:'customer service',ms:'khidmat pelanggan',zh:'客服'},promotion:{en:'promotions',ms:'promosi',zh:'优惠'},bank_account:{en:'your bank account',ms:'akaun bank',zh:'银行账户'}};
export const CHOICE_TXT={en:t=>`Sure! What would you like to know about ${t}?`,ms:t=>`Baik! Apa yang anda ingin tahu tentang ${t}?`,zh:t=>`好的！您想了解${t}的哪方面？`};
export const PICK_TXT={en:'Which one do you need help with?',ms:'Yang mana satu yang anda perlukan?',zh:'请问您需要哪方面的帮助？'};
export const AGENT={en:'Talk to an agent',ms:'Cakap dengan ejen',zh:'转人工客服'};
export const SMALL_REPLY={
 friendly:{greeting:{en:'Hi there! 😊 How can I help you today?',ms:'Hai! 😊 Apa yang boleh saya bantu hari ini?',zh:'您好！😊 请问有什么可以帮您？'},
           morning:{en:'Good morning! ☀️ How can I help you today?',ms:'Selamat pagi! ☀️ Apa yang boleh saya bantu hari ini?',zh:'早上好！☀️ 请问有什么可以帮您？'},
           thanks:{en:"You're welcome! Just message me if you need anything else.",ms:'Sama-sama! Mesej saya jika perlukan bantuan lagi.',zh:'不客气！如果还有需要，随时找我。'},
           callout:{en:"Yes, I'm here! 😊 How can I help you?",ms:'Ya, saya ada di sini! 😊 Apa yang boleh saya bantu?',zh:'我在的！😊 请问有什么可以帮您？'},
           ack:{en:'👍 Anything else I can help with?',ms:'👍 Ada apa-apa lagi yang boleh saya bantu?',zh:'👍 还有其他需要帮忙的吗？'},
           bye:{en:'Bye! Have a great day! 👋',ms:'Jumpa lagi! Semoga hari anda indah! 👋',zh:'再见！祝您有美好的一天！👋'}},
 formal:{greeting:{en:'Hello. How may we assist you today?',ms:'Helo. Bagaimana kami boleh membantu anda hari ini?',zh:'您好，请问有什么可以为您效劳？'},
         morning:{en:'Good morning. How may we assist you today?',ms:'Selamat pagi. Bagaimana kami boleh membantu anda hari ini?',zh:'早上好，请问有什么可以为您效劳？'},
         thanks:{en:'You are most welcome. Please contact us if you need further assistance.',ms:'Sama-sama. Sila hubungi kami jika memerlukan bantuan lanjut.',zh:'不客气。如需进一步协助，请随时联系我们。'},
         callout:{en:'Yes, we are here. How may we assist you?',ms:'Ya, kami ada di sini. Bagaimana kami boleh membantu anda?',zh:'我们在的，请问有什么可以为您效劳？'},
         ack:{en:'Understood. Is there anything else we may assist you with?',ms:'Baik. Adakah terdapat apa-apa lagi yang boleh kami bantu?',zh:'好的，请问还有其他可以为您效劳的吗？'},
         bye:{en:'Thank you for contacting us. Have a pleasant day.',ms:'Terima kasih kerana menghubungi kami. Semoga hari anda menyenangkan.',zh:'感谢您联系我们，祝您愉快。'}}};
export const lblOf=(k,lg)=>(LABEL[k]&&LABEL[k][lg])||k.replace(/_/g,' ');
export const ansOf=(e,lg)=>(e&&e.translations&&((e.translations[lg]||{}).answer_text||(e.translations.en||{}).answer_text))||'';
export const tlab=(k,lg)=>(TOPIC_LABEL[k]&&TOPIC_LABEL[k][lg])||k.replace(/_/g,' ');
export const AMT_LABEL={deposit:{en:a=>`Deposit ${a}`,ms:a=>`Deposit ${a}`,zh:a=>`存款${a}`},withdraw:{en:a=>`Withdraw ${a}`,ms:a=>`Keluarkan ${a}`,zh:a=>`提款${a}`},check:{en:a=>`Check my ${a} transaction`,ms:a=>`Semak transaksi ${a} saya`,zh:a=>`查询我的${a}交易`}};
export const AMT_ASK={en:(a)=>`Got it, ${a}. What would you like to do?`,ms:(a)=>`Baik, ${a}. Apa yang anda ingin buat?`,zh:(a)=>`收到，${a}。请问您想做什么？`};
export const AMT_ASK2={en:(a,k)=>`Got it, ${a}. Is this for a ${KIND_W[k].en}?`,ms:(a,k)=>`Baik, ${a}. Adakah ini untuk ${KIND_W[k].ms}?`,zh:(a,k)=>`收到，${a}。请问是要${KIND_W[k].zh}吗？`};
export const LIM_OK={en:(a,lo,hi)=>`${a} is within the limits (minimum ${lo}, maximum ${hi} per transaction).`,ms:(a,lo,hi)=>`${a} berada dalam had yang dibenarkan (minimum ${lo}, maksimum ${hi} setiap transaksi).`,zh:(a,lo,hi)=>`${a}在允许范围内（最低${lo}，单笔最高${hi}）。`};
export const LIM_LOW={en:(a,k,lo)=>`${a} is below the minimum ${k} of ${lo}.`,ms:(a,k,lo)=>`${a} kurang daripada ${k} minimum iaitu ${lo}.`,zh:(a,k,lo)=>`${a}低于最低${k}金额${lo}。`};
export const LIM_HIGH={en:(a,hi)=>`${a} is above the maximum of ${hi} per transaction.`,ms:(a,hi)=>`${a} melebihi maksimum ${hi} setiap transaksi.`,zh:(a,hi)=>`${a}超过单笔最高${hi}。`};
export const GUIDE_ONLY={en:'I can only guide you here. The transaction itself is done in the app.',ms:'Saya hanya boleh memberi panduan di sini. Transaksi dibuat dalam aplikasi.',zh:'我只能在这里提供指引，交易需在应用内完成。'};
export const FOUND_TX={en:'I checked your account. I found this:',ms:'Saya telah semak akaun anda. Saya menjumpai ini:',zh:'我已查看您的账户，找到这笔记录：'};
export const NOTFOUND_TX={en:a=>`I checked your account but could not find a recent transaction of ${a}. I can connect you to an agent to look deeper.`,ms:a=>`Saya telah semak akaun anda tetapi tidak menjumpai transaksi terkini sebanyak ${a}. Saya boleh sambungkan anda kepada ejen untuk semakan lanjut.`,zh:a=>`我已查看您的账户，但没有找到最近${a}的交易。我可以帮您转接客服进一步查询。`};
export const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
export const ST={pending:{en:'is still waiting for bank confirmation',ms:'masih menunggu pengesahan bank',zh:'仍在等待银行确认'},processing:{en:'is being processed',ms:'sedang diproses',zh:'正在处理中'},success:{en:'was completed successfully',ms:'telah berjaya diselesaikan',zh:'已成功完成'},failed:{en:'was rejected by the bank',ms:'ditolak oleh bank',zh:'被银行拒绝'}};
export const DAYT={today:{en:'today',ms:'hari ini',zh:'今天'},yesterday:{en:'yesterday',ms:'semalam',zh:'昨天'},'3d':{en:'3 days ago',ms:'3 hari lalu',zh:'3天前'}};
export const whenT=(tx,lg)=>{ const d=DAYT[tx.day][lg]; if(!tx.hm) return d; return lg==='en'?`${d} at ${tx.hm}`:lg==='ms'?`${d} jam ${tx.hm}`:`${d}${tx.hm}`; };
export const KIND_W={deposit:{en:'deposit',ms:'deposit',zh:'存款'},withdraw:{en:'withdrawal',ms:'pengeluaran',zh:'提款'}};
export const SENT={en:(k,a,r,w,s)=>`I checked your account. Your latest ${k} of ${a} (ref ${r}), made ${w}, ${s}.`,
  ms:(k,a,r,w,s)=>`Saya telah semak akaun anda. ${k.charAt(0).toUpperCase()+k.slice(1)} terkini anda sebanyak ${a} (rujukan ${r}), dibuat ${w}, ${s}.`,
  zh:(k,a,r,w,s)=>`我已查看您的账户。您最近一笔${a}的${k}（单号${r}），于${w}提交，${s}。`};
export const NOTX={en:k=>`I checked your account but could not find a recent ${k}.`,ms:k=>`Saya telah semak akaun anda tetapi tidak menjumpai ${k} terkini.`,zh:k=>`我已查看您的账户，但没有找到最近的${k}记录。`};
export const NOTVER={en:"I can't see your account in this chat. Please log in on our website so I can check it, or I can connect you to an agent.",ms:'Saya tidak dapat melihat akaun anda dalam sembang ini. Sila log masuk di laman web kami supaya saya boleh menyemak, atau saya boleh sambungkan anda kepada ejen.',zh:'我在这个对话中看不到您的账户。请先在网站登录，我才能为您查询，或者我可以帮您转接客服。'};
export const FAILHINT={en:' Please tap "Talk to an agent" and we will help you.',ms:' Sila tekan "Cakap dengan ejen" dan kami akan membantu anda.',zh:'请点击“转人工客服”，我们会协助您。'};
export const ACCT_PRE={friendly:{en:n=>`Hi ${n}! `,ms:n=>`Hai ${n}! `,zh:n=>`${n}您好！`},formal:{en:n=>`Dear ${n}, `,ms:n=>`Tuan/Puan ${n}, `,zh:n=>`尊敬的${n}，`}};
export const STATUS_LABEL={deposit:{en:'Check my latest deposit',ms:'Semak deposit terkini saya',zh:'查询我最近的存款'},withdraw:{en:'Check my latest withdrawal',ms:'Semak pengeluaran terkini saya',zh:'查询我最近的提款'}};
export const TXT_BAL={en:a=>`I checked your account. Your current balance is ${a}.`,ms:a=>`Saya telah semak akaun anda. Baki semasa anda ialah ${a}.`,zh:a=>`我已查看您的账户。您当前的余额为${a}。`};
export const TXT_PTS={en:(p,l)=>`I checked your account. You currently have ${p} points (${l} level).`,ms:(p,l)=>`Saya telah semak akaun anda. Anda kini mempunyai ${p} mata (tahap ${l}).`,zh:(p,l)=>`我已查看您的账户。您目前有${p}积分（${l}等级）。`};
export const TXT_TXN={en:'I checked your account. Your latest transactions:',ms:'Saya telah semak akaun anda. Transaksi terkini anda:',zh:'我已查看您的账户。您最近的交易记录：'};
export const TYPE_W={deposit:{en:'Deposit',ms:'Deposit',zh:'存款'},withdraw:{en:'Withdrawal',ms:'Pengeluaran',zh:'提款'}};
export const STS={pending:{en:'waiting for bank confirmation',ms:'menunggu pengesahan bank',zh:'等待银行确认'},processing:{en:'processing',ms:'sedang diproses',zh:'处理中'},success:{en:'completed',ms:'berjaya',zh:'已完成'},failed:{en:'rejected by the bank',ms:'ditolak bank',zh:'被银行拒绝'}};
export const NODATA={en:'I checked your account but could not find any records.',ms:'Saya telah semak akaun anda tetapi tidak menjumpai sebarang rekod.',zh:'我已查看您的账户，但没有找到任何记录。'};
export const REFUSE_TXT={friendly:{en:"Sorry, for your security I can't show or send passwords, OTP codes, or full bank, card and ID numbers in chat. I can connect you to an agent if you need help.",ms:'Maaf, demi keselamatan anda, saya tidak boleh menunjukkan atau menghantar kata laluan, kod OTP, atau nombor penuh bank, kad dan IC dalam sembang. Saya boleh sambungkan anda kepada ejen jika perlu.',zh:'抱歉，为了您的安全，我不能在聊天中显示或发送密码、验证码，或完整的银行卡号和身份证号。如需帮助，我可以帮您转接客服。'},
  formal:{en:'For your security, we cannot show or send passwords, OTP codes, or full bank, card and ID numbers in chat. We can connect you to an agent if you need assistance.',ms:'Demi keselamatan anda, kami tidak boleh menunjukkan atau menghantar kata laluan, kod OTP, atau nombor penuh bank, kad dan IC dalam sembang. Kami boleh menyambungkan anda kepada ejen jika memerlukan bantuan.',zh:'为了您的安全，我们无法在聊天中显示或发送密码、验证码，或完整的银行卡号和身份证号。如需协助，我们可以为您转接客服。'}};
export const KIND_DEF={
 friendly:{en:["I'm sorry things are frustrating right now. 🙏 I really want to help. Could you tell me what the problem is? Please keep our chat respectful so I can assist you better.","I understand you're upset, and I'm sorry for the trouble. Let me help you quickly. If you prefer, tap “Talk to an agent”."],
           ms:['Maaf kalau keadaan ini menyusahkan anda. 🙏 Saya betul-betul mahu membantu. Boleh bagitahu apa masalahnya? Mohon kekalkan perbualan yang sopan supaya saya boleh membantu dengan lebih baik.','Saya faham anda tidak berpuas hati dan saya minta maaf atas kesulitan ini. Biar saya bantu dengan cepat. Jika mahu, tekan “Cakap dengan ejen”.'],
           zh:['很抱歉让您感到不愉快。🙏 我很想帮到您，请告诉我具体遇到了什么问题？也请保持友善交流，这样我能更好地协助您。','我理解您很着急，对造成的麻烦深感抱歉。我马上帮您处理；如果您愿意，也可以点击“转人工客服”。']},
 formal:{en:['We apologise for the inconvenience. We would like to assist you. Could you please describe the issue? We kindly ask that our conversation remain respectful.','We understand your frustration and apologise. We will help as quickly as possible. You may also request an agent.'],
         ms:['Kami memohon maaf atas kesulitan ini. Kami ingin membantu anda. Boleh anda terangkan masalahnya? Kami mohon perbualan ini kekal sopan.','Kami faham kekecewaan anda dan memohon maaf. Kami akan membantu secepat mungkin. Anda juga boleh meminta ejen.'],
         zh:['对于给您带来的不便，我们深表歉意。我们很乐意协助您，请问具体是什么问题？也恳请保持礼貌交流。','我们理解您的心情并深表歉意，会尽快为您处理。您也可以要求转接人工客服。']}};

export const REASK_TXT = {
  friendly: { en: "Sorry, I didn't quite catch that 😅 Could you tell me a bit more, or tap what you need help with?",
              ms: 'Maaf, saya kurang faham 😅 Boleh terangkan sikit lagi, atau tekan yang anda perlukan?',
              zh: '抱歉，我没太明白 😅 可以再详细说一下吗？或者点选您需要的帮助。' },
  formal: { en: 'Sorry, we did not quite understand your message. Could you please tell us a little more, or choose from the options below?',
            ms: 'Maaf, kami kurang faham mesej anda. Boleh anda terangkan dengan lebih lanjut, atau pilih daripada pilihan di bawah?',
            zh: '抱歉，我们没有完全理解您的消息。请您再详细说明一下，或从下方选项中选择。' },
};
