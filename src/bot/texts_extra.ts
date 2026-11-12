// The bot's sentences in Vietnamese (vi), Thai (th) and Filipino (tl), in the same shapes as texts.ts. They are merged into those tables when texts.ts loads.
// Vietnamese: friendly = "mình / anh/chị", formal = "chúng tôi / quý khách". Thai: polite endings ค่ะ / คะ, customer = "คุณลูกค้า".
// Filipino: polite "po", plain Tagalog with the English words that customers really use (deposit, withdraw, agent).
// @ts-nocheck
export const EXTRA = {
  LABEL: {
    deposit_how: { vi: 'cách nạp tiền', th: 'วิธีฝากเงิน', tl: 'paano mag-deposit' },
    deposit_time: { vi: 'thời gian tiền nạp vào tài khoản', th: 'เวลาเงินฝากเข้าบัญชี', tl: 'oras ng pagpasok ng deposit' },
    deposit_limit: { vi: 'hạn mức nạp tiền', th: 'วงเงินฝาก', tl: 'limitasyon ng deposit' },
    withdraw_how: { vi: 'cách rút tiền', th: 'วิธีถอนเงิน', tl: 'paano mag-withdraw' },
    withdraw_time: { vi: 'thời gian rút tiền', th: 'เวลาถอนเงิน', tl: 'oras ng withdrawal' },
    withdraw_limit: { vi: 'hạn mức rút tiền', th: 'วงเงินถอน', tl: 'limitasyon ng withdrawal' },
    forgot_password: { vi: 'quên mật khẩu', th: 'ลืมรหัสผ่าน', tl: 'nakalimutang password' },
    verify_account: { vi: 'xác minh tài khoản', th: 'การยืนยันบัญชี', tl: 'beripikasyon ng account' },
    change_bank: { vi: 'đổi tài khoản ngân hàng', th: 'เปลี่ยนบัญชีธนาคาร', tl: 'pagpapalit ng bank account' },
    contact_hours: { vi: 'giờ làm việc của CSKH', th: 'เวลาทำการของฝ่ายบริการลูกค้า', tl: 'oras ng customer service' },
    promo_bonus: { vi: 'khuyến mãi', th: 'โปรโมชัน', tl: 'mga promo' },
    turnover_how: { vi: 'điều kiện doanh thu cược (turnover)', th: 'เงื่อนไขยอดเทิร์นโอเวอร์', tl: 'kinakailangang turnover' },
    transfer_fee: { vi: 'phí chuyển khoản', th: 'ค่าธรรมเนียมการโอน', tl: 'bayad sa transfer' },
    refund_how: { vi: 'hoàn tiền', th: 'การคืนเงิน', tl: 'refund' },
    register_how: { vi: 'cách đăng ký', th: 'วิธีสมัครสมาชิก', tl: 'paano mag-register' },
  },
  TONE: {
    friendly: {
      pre: { vi: 'Chào anh/chị! ', th: 'สวัสดีค่ะ ', tl: 'Kumusta po! ' },
      post: { vi: ' Anh/chị cần mình hỗ trợ gì thêm không ạ? 😊', th: ' มีอะไรให้ช่วยอีกไหมคะ 😊', tl: ' May maitutulong pa po ba ako? 😊' },
    },
    formal: {
      pre: { vi: 'Cảm ơn quý khách đã liên hệ với chúng tôi. ', th: 'ขอบคุณที่ติดต่อเรา ', tl: 'Salamat po sa pakikipag-ugnayan sa amin. ' },
      post: { vi: ' Quý khách có cần chúng tôi hỗ trợ thêm điều gì không ạ?', th: ' มีเรื่องอื่นที่เราสามารถช่วยเหลือคุณลูกค้าอีกไหมคะ', tl: ' May iba pa po bang maitutulong namin sa inyo?' },
    },
  },
  CLARIFY_TXT: {
    vi: (a, b) => `Xin lỗi, mình muốn chắc chắn là hỗ trợ đúng ý anh/chị. Anh/chị đang hỏi về ${a} hay ${b} ạ?`,
    th: (a, b) => `ขออภัยค่ะ ขอสอบถามเพื่อให้ช่วยได้ถูกต้อง คุณลูกค้าต้องการสอบถามเรื่อง${a}หรือ${b}คะ`,
    tl: (a, b) => `Pasensya na po, gusto kong makasiguro na tama ang maitutulong ko. Tungkol po ba sa ${a} o ${b} ang tanong ninyo?`,
  },
  GREET: {
    vi: (n) => `Xin chào, mình là trợ lý AI của ${n}. Anh/chị có thể hỏi mình về nạp tiền, rút tiền, tài khoản hoặc khuyến mãi.`,
    th: (n) => `สวัสดีค่ะ ดิฉันเป็นผู้ช่วย AI ของ ${n} สอบถามเรื่องการฝากเงิน การถอนเงิน บัญชี หรือโปรโมชันได้เลยค่ะ`,
    tl: (n) => `Kumusta po, ako ang AI assistant ng ${n}. Maaari po kayong magtanong tungkol sa deposit, withdrawal, account, o mga promo.`,
  },
  TOPIC_LABEL: {
    turnover: { vi: 'doanh thu cược (turnover)', th: 'ยอดเทิร์นโอเวอร์', tl: 'turnover' },
    transfer: { vi: 'chuyển khoản', th: 'การโอนเงิน', tl: 'mga transfer' },
    refund: { vi: 'hoàn tiền', th: 'การคืนเงิน', tl: 'refund' },
    register: { vi: 'đăng ký', th: 'การสมัครสมาชิก', tl: 'pagpaparehistro' },
    deposit: { vi: 'nạp tiền', th: 'การฝากเงิน', tl: 'deposit' },
    withdraw: { vi: 'rút tiền', th: 'การถอนเงิน', tl: 'withdrawal' },
    password: { vi: 'mật khẩu', th: 'รหัสผ่าน', tl: 'password' },
    verify: { vi: 'xác minh tài khoản', th: 'การยืนยันบัญชี', tl: 'beripikasyon ng account' },
    customer_service: { vi: 'chăm sóc khách hàng', th: 'ฝ่ายบริการลูกค้า', tl: 'customer service' },
    promotion: { vi: 'khuyến mãi', th: 'โปรโมชัน', tl: 'mga promo' },
    bank_account: { vi: 'tài khoản ngân hàng', th: 'บัญชีธนาคาร', tl: 'bank account' },
  },
  CHOICE_TXT: {
    vi: (t) => `Vâng ạ! Anh/chị muốn biết điều gì về ${t}?`,
    th: (t) => `ได้เลยค่ะ คุณลูกค้าต้องการทราบเรื่องอะไรเกี่ยวกับ${t}คะ`,
    tl: (t) => `Sige po! Ano po ang gusto ninyong malaman tungkol sa ${t}?`,
  },
  PICK_TXT: { vi: 'Anh/chị cần hỗ trợ về vấn đề nào ạ?', th: 'คุณลูกค้าต้องการให้ช่วยเรื่องไหนคะ', tl: 'Alin po sa mga ito ang kailangan ninyo ng tulong?' },
  MORE_HELP: {
    vi: 'Nếu cần hỗ trợ thêm, anh/chị có thể liên hệ nhân viên hỗ trợ.',
    th: 'หากต้องการความช่วยเหลือเพิ่มเติม สามารถติดต่อเจ้าหน้าที่ได้ค่ะ',
    tl: 'Kung kailangan ninyo ng iba pang tulong, maaari po kayong makipag-ugnayan sa isang agent.',
  },
  AGENT: { vi: 'Gặp nhân viên hỗ trợ', th: 'คุยกับเจ้าหน้าที่', tl: 'Makipag-usap sa agent' },
  SMALL_REPLY: {
    friendly: {
      greeting: { vi: 'Chào anh/chị! 😊 Mình có thể giúp gì cho anh/chị hôm nay?', th: 'สวัสดีค่ะ 😊 วันนี้ให้ช่วยอะไรดีคะ', tl: 'Kumusta po! 😊 Ano po ang maitutulong ko sa inyo ngayon?' },
      morning: { vi: 'Chào buổi sáng! ☀️ Mình có thể giúp gì cho anh/chị hôm nay?', th: 'อรุณสวัสดิ์ค่ะ ☀️ วันนี้ให้ช่วยอะไรดีคะ', tl: 'Magandang umaga po! ☀️ Ano po ang maitutulong ko sa inyo ngayon?' },
      thanks: { vi: 'Không có gì ạ! Cần gì thêm anh/chị cứ nhắn cho mình nhé.', th: 'ยินดีค่ะ หากต้องการความช่วยเหลือเพิ่มเติม ส่งข้อความมาได้เลยนะคะ', tl: 'Walang anuman po! Mag-message lang po kayo kung may kailangan pa kayo.' },
      callout: { vi: 'Dạ, mình đây ạ! 😊 Mình có thể giúp gì cho anh/chị?', th: 'อยู่ค่ะ 😊 ให้ช่วยอะไรดีคะ', tl: 'Opo, nandito po ako! 😊 Ano po ang maitutulong ko?' },
      ack: { vi: '👍 Anh/chị cần mình hỗ trợ gì thêm không ạ?', th: '👍 มีอะไรให้ช่วยอีกไหมคะ', tl: '👍 May iba pa po ba akong maitutulong?' },
      bye: { vi: 'Tạm biệt anh/chị! Chúc anh/chị một ngày tốt lành! 👋', th: 'แล้วพบกันใหม่นะคะ ขอให้มีวันที่ดีค่ะ 👋', tl: 'Paalam po! Magandang araw sa inyo! 👋' },
    },
    formal: {
      greeting: { vi: 'Xin chào quý khách. Chúng tôi có thể hỗ trợ gì cho quý khách hôm nay?', th: 'สวัสดีค่ะ มีอะไรให้เราช่วยเหลือคุณลูกค้าวันนี้คะ', tl: 'Magandang araw po. Paano po namin kayo matutulungan ngayon?' },
      morning: { vi: 'Chào buổi sáng quý khách. Chúng tôi có thể hỗ trợ gì cho quý khách hôm nay?', th: 'สวัสดีตอนเช้าค่ะ มีอะไรให้เราช่วยเหลือคุณลูกค้าวันนี้คะ', tl: 'Magandang umaga po. Paano po namin kayo matutulungan ngayon?' },
      thanks: { vi: 'Rất hân hạnh được hỗ trợ quý khách. Nếu cần thêm trợ giúp, xin vui lòng liên hệ với chúng tôi.', th: 'ยินดีเป็นอย่างยิ่งค่ะ หากต้องการความช่วยเหลือเพิ่มเติม กรุณาติดต่อเราได้เลยค่ะ', tl: 'Walang anuman po. Makipag-ugnayan lang po sa amin kung kailangan ninyo ng karagdagang tulong.' },
      callout: { vi: 'Dạ, chúng tôi đây ạ. Chúng tôi có thể hỗ trợ gì cho quý khách?', th: 'เราอยู่ค่ะ มีอะไรให้เราช่วยเหลือคะ', tl: 'Opo, nandito po kami. Paano po namin kayo matutulungan?' },
      ack: { vi: 'Chúng tôi đã hiểu. Quý khách cần chúng tôi hỗ trợ thêm điều gì không ạ?', th: 'รับทราบค่ะ มีเรื่องอื่นที่เราสามารถช่วยเหลือเพิ่มเติมอีกไหมคะ', tl: 'Naiintindihan po. May iba pa po ba kaming maitutulong sa inyo?' },
      bye: { vi: 'Cảm ơn quý khách đã liên hệ với chúng tôi. Chúc quý khách một ngày tốt lành.', th: 'ขอบคุณที่ติดต่อเรา ขอให้มีวันที่ดีค่ะ', tl: 'Salamat po sa pakikipag-ugnayan sa amin. Magandang araw po.' },
    },
  },
  AMT_LABEL: {
    deposit: { vi: (a) => `Nạp ${a}`, th: (a) => `ฝากเงิน ${a}`, tl: (a) => `Mag-deposit ng ${a}` },
    withdraw: { vi: (a) => `Rút ${a}`, th: (a) => `ถอนเงิน ${a}`, tl: (a) => `Mag-withdraw ng ${a}` },
    check: { vi: (a) => `Kiểm tra giao dịch ${a} của tôi`, th: (a) => `ตรวจสอบรายการ ${a} ของฉัน`, tl: (a) => `Tingnan ang ${a} kong transaksyon` },
  },
  AMT_ASK: {
    vi: (a) => `Mình đã nhận được ${a}. Anh/chị muốn làm gì ạ?`,
    th: (a) => `รับทราบค่ะ ${a} คุณลูกค้าต้องการทำรายการอะไรคะ`,
    tl: (a) => `Sige po, ${a}. Ano po ang gusto ninyong gawin?`,
  },
  AMT_ASK2: {
    vi: (a, k) => `Mình đã nhận được ${a}. Đây là giao dịch ${EXTRA.KIND_W[k].vi} phải không ạ?`,
    th: (a, k) => `รับทราบค่ะ ${a} เป็นรายการ${EXTRA.KIND_W[k].th}ใช่ไหมคะ`,
    tl: (a, k) => `Sige po, ${a}. Para po ba ito sa ${EXTRA.KIND_W[k].tl}?`,
  },
  LIM_OK: {
    vi: (a, lo, hi) => `${a} nằm trong hạn mức cho phép (tối thiểu ${lo}, tối đa ${hi} mỗi giao dịch).`,
    th: (a, lo, hi) => `${a} อยู่ในวงเงินที่กำหนดค่ะ (ขั้นต่ำ ${lo} สูงสุด ${hi} ต่อรายการ)`,
    tl: (a, lo, hi) => `Ang ${a} ay pasok sa limitasyon (minimum ${lo}, maximum ${hi} bawat transaksyon).`,
  },
  LIM_LOW: {
    vi: (a, k, lo) => `${a} thấp hơn mức ${k} tối thiểu là ${lo}.`,
    th: (a, k, lo) => `${a} ต่ำกว่ายอด${k}ขั้นต่ำ ${lo} ค่ะ`,
    tl: (a, k, lo) => `Ang ${a} ay mas mababa sa minimum na ${k} na ${lo}.`,
  },
  LIM_HIGH: {
    vi: (a, hi) => `${a} vượt quá mức tối đa ${hi} mỗi giao dịch.`,
    th: (a, hi) => `${a} เกินยอดสูงสุด ${hi} ต่อรายการค่ะ`,
    tl: (a, hi) => `Ang ${a} ay higit sa maximum na ${hi} bawat transaksyon.`,
  },
  GUIDE_ONLY: {
    vi: 'Mình chỉ có thể hướng dẫn tại đây. Giao dịch cần được thực hiện trong ứng dụng.',
    th: 'ดิฉันให้คำแนะนำได้ที่นี่เท่านั้นค่ะ ส่วนการทำรายการต้องทำในแอป',
    tl: 'Gabay lang po ang maibibigay ko dito. Ang mismong transaksyon ay ginagawa sa app.',
  },
  FOUND_TX: {
    vi: 'Mình đã kiểm tra tài khoản của anh/chị và thấy giao dịch này:',
    th: 'ดิฉันตรวจสอบบัญชีของคุณลูกค้าแล้ว พบรายการนี้ค่ะ:',
    tl: 'Tiningnan ko po ang account ninyo. Ito ang nakita ko:',
  },
  NOTFOUND_TX: {
    vi: (a) => `Mình đã kiểm tra tài khoản nhưng không thấy giao dịch ${a} gần đây. Mình có thể kết nối anh/chị với nhân viên để kiểm tra kỹ hơn.`,
    th: (a) => `ดิฉันตรวจสอบบัญชีแล้ว แต่ไม่พบรายการ ${a} ล่าสุด ดิฉันสามารถโอนสายให้เจ้าหน้าที่ช่วยตรวจสอบเพิ่มเติมได้ค่ะ`,
    tl: (a) => `Tiningnan ko po ang account ninyo pero wala akong nakitang kamakailang transaksyon na ${a}. Maaari ko po kayong ikonekta sa agent para masuri pa.`,
  },
  ST: {
    pending: { vi: 'vẫn đang chờ ngân hàng xác nhận', th: 'ยังรอการยืนยันจากธนาคาร', tl: 'naghihintay pa ng kumpirmasyon ng bank' },
    processing: { vi: 'đang được xử lý', th: 'กำลังดำเนินการ', tl: 'pinoproseso' },
    success: { vi: 'đã hoàn tất thành công', th: 'สำเร็จเรียบร้อยแล้ว', tl: 'matagumpay na natapos' },
    failed: { vi: 'bị ngân hàng từ chối', th: 'ถูกธนาคารปฏิเสธ', tl: 'tinanggihan ng bank' },
  },
  DAYT: {
    today: { vi: 'hôm nay', th: 'วันนี้', tl: 'ngayong araw' },
    yesterday: { vi: 'hôm qua', th: 'เมื่อวานนี้', tl: 'kahapon' },
    '3d': { vi: '3 ngày trước', th: '3 วันที่แล้ว', tl: '3 araw na ang nakalipas' },
  },
  KIND_W: {
    deposit: { vi: 'nạp tiền', th: 'ฝากเงิน', tl: 'deposit' },
    withdraw: { vi: 'rút tiền', th: 'ถอนเงิน', tl: 'withdrawal' },
  },
  SENT: {
    vi: (k, a, r, w, s) => `Mình đã kiểm tra tài khoản của anh/chị. Giao dịch ${k} gần nhất ${a} (mã ${r}), thực hiện ${w}, ${s}.`,
    th: (k, a, r, w, s) => `ดิฉันตรวจสอบบัญชีของคุณลูกค้าแล้ว รายการ${k}ล่าสุด ${a} (เลขอ้างอิง ${r}) ทำรายการ${w} ${s}ค่ะ`,
    tl: (k, a, r, w, s) => `Tiningnan ko po ang account ninyo. Ang pinakahuling ${k} ninyo na ${a} (ref ${r}), ginawa ${w}, ${s}.`,
  },
  NOTX: {
    vi: (k) => `Mình đã kiểm tra tài khoản nhưng không thấy giao dịch ${k} gần đây.`,
    th: (k) => `ดิฉันตรวจสอบบัญชีแล้ว แต่ไม่พบรายการ${k}ล่าสุดค่ะ`,
    tl: (k) => `Tiningnan ko po ang account ninyo pero wala akong nakitang kamakailang ${k}.`,
  },
  NOTVER: {
    vi: 'Mình không thấy tài khoản của anh/chị trong cuộc trò chuyện này. Anh/chị vui lòng đăng nhập trên website để mình kiểm tra, hoặc mình có thể kết nối anh/chị với nhân viên.',
    th: 'ดิฉันไม่เห็นบัญชีของคุณลูกค้าในแชตนี้ค่ะ กรุณาเข้าสู่ระบบบนเว็บไซต์เพื่อให้ตรวจสอบได้ หรือดิฉันสามารถโอนสายให้เจ้าหน้าที่ได้ค่ะ',
    tl: 'Hindi ko po makita ang account ninyo sa chat na ito. Mag-log in po kayo sa aming website para masuri ko, o maaari ko po kayong ikonekta sa agent.',
  },
  FAILHINT: {
    vi: ' Vui lòng nhấn "Gặp nhân viên hỗ trợ" để chúng tôi hỗ trợ anh/chị.',
    th: ' กรุณากด "คุยกับเจ้าหน้าที่" แล้วเราจะช่วยเหลือคุณลูกค้าค่ะ',
    tl: ' Pindutin lang po ang "Makipag-usap sa agent" at tutulungan namin kayo.',
  },
  ACCT_PRE: {
    friendly: { vi: (n) => `Chào ${n}! `, th: (n) => `สวัสดีค่ะ คุณ${n} `, tl: (n) => `Kumusta po ${n}! ` },
    formal: { vi: (n) => `Kính gửi ${n}, `, th: (n) => `เรียน คุณ${n} `, tl: (n) => `Mahal na ${n}, ` },
  },
  STATUS_LABEL: {
    deposit: { vi: 'Kiểm tra giao dịch nạp gần nhất của tôi', th: 'ตรวจสอบรายการฝากล่าสุดของฉัน', tl: 'Tingnan ang pinakahuli kong deposit' },
    withdraw: { vi: 'Kiểm tra giao dịch rút gần nhất của tôi', th: 'ตรวจสอบรายการถอนล่าสุดของฉัน', tl: 'Tingnan ang pinakahuli kong withdrawal' },
  },
  TXT_BAL: {
    vi: (a) => `Mình đã kiểm tra tài khoản của anh/chị. Số dư hiện tại là ${a}.`,
    th: (a) => `ดิฉันตรวจสอบบัญชีของคุณลูกค้าแล้ว ยอดคงเหลือปัจจุบันคือ ${a} ค่ะ`,
    tl: (a) => `Tiningnan ko po ang account ninyo. Ang kasalukuyang balanse ninyo ay ${a}.`,
  },
  TXT_PTS: {
    vi: (p, l) => `Mình đã kiểm tra tài khoản của anh/chị. Hiện anh/chị có ${p} điểm (hạng ${l}).`,
    th: (p, l) => `ดิฉันตรวจสอบบัญชีของคุณลูกค้าแล้ว ขณะนี้มี ${p} คะแนน (ระดับ ${l}) ค่ะ`,
    tl: (p, l) => `Tiningnan ko po ang account ninyo. Mayroon po kayong ${p} puntos (level ${l}).`,
  },
  TXT_TXN: {
    vi: 'Mình đã kiểm tra tài khoản của anh/chị. Các giao dịch gần nhất:',
    th: 'ดิฉันตรวจสอบบัญชีของคุณลูกค้าแล้ว รายการล่าสุดดังนี้ค่ะ:',
    tl: 'Tiningnan ko po ang account ninyo. Ito ang mga huling transaksyon ninyo:',
  },
  TYPE_W: {
    deposit: { vi: 'Nạp tiền', th: 'ฝากเงิน', tl: 'Deposit' },
    withdraw: { vi: 'Rút tiền', th: 'ถอนเงิน', tl: 'Withdrawal' },
  },
  STS: {
    pending: { vi: 'chờ ngân hàng xác nhận', th: 'รอการยืนยันจากธนาคาร', tl: 'naghihintay ng kumpirmasyon ng bank' },
    processing: { vi: 'đang xử lý', th: 'กำลังดำเนินการ', tl: 'pinoproseso' },
    success: { vi: 'hoàn tất', th: 'สำเร็จ', tl: 'natapos' },
    failed: { vi: 'bị ngân hàng từ chối', th: 'ถูกธนาคารปฏิเสธ', tl: 'tinanggihan ng bank' },
  },
  NODATA: {
    vi: 'Mình đã kiểm tra tài khoản nhưng không tìm thấy bản ghi nào.',
    th: 'ดิฉันตรวจสอบบัญชีแล้ว แต่ไม่พบรายการใดๆ ค่ะ',
    tl: 'Tiningnan ko po ang account ninyo pero wala akong nakitang anumang tala.',
  },
  REFUSE_TXT: {
    friendly: {
      vi: 'Xin lỗi, vì an toàn của anh/chị, mình không thể hiển thị hay gửi mật khẩu, mã OTP, hoặc số đầy đủ của tài khoản ngân hàng, thẻ và giấy tờ tùy thân trong cuộc trò chuyện. Mình có thể kết nối anh/chị với nhân viên nếu cần hỗ trợ.',
      th: 'ขออภัยค่ะ เพื่อความปลอดภัยของคุณลูกค้า ดิฉันไม่สามารถแสดงหรือส่งรหัสผ่าน รหัส OTP หรือเลขบัญชีธนาคาร เลขบัตร และเลขบัตรประชาชนแบบเต็มในแชตได้ หากต้องการความช่วยเหลือ ดิฉันสามารถโอนสายให้เจ้าหน้าที่ได้ค่ะ',
      tl: 'Pasensya na po, para sa seguridad ninyo, hindi ko po maipapakita o maipapadala ang password, OTP code, o buong numero ng bank, card, at ID dito sa chat. Maaari ko po kayong ikonekta sa agent kung kailangan ninyo ng tulong.',
    },
    formal: {
      vi: 'Vì sự an toàn của quý khách, chúng tôi không thể hiển thị hay gửi mật khẩu, mã OTP, hoặc số đầy đủ của tài khoản ngân hàng, thẻ và giấy tờ tùy thân trong cuộc trò chuyện. Chúng tôi có thể kết nối quý khách với nhân viên nếu cần hỗ trợ.',
      th: 'เพื่อความปลอดภัยของคุณลูกค้า เราไม่สามารถแสดงหรือส่งรหัสผ่าน รหัส OTP หรือเลขบัญชีธนาคาร เลขบัตร และเลขบัตรประชาชนแบบเต็มในแชตได้ หากต้องการความช่วยเหลือ เราสามารถโอนสายให้เจ้าหน้าที่ได้ค่ะ',
      tl: 'Para sa inyong seguridad, hindi po namin maipapakita o maipapadala ang password, OTP code, o buong numero ng bank, card, at ID sa chat. Maaari po namin kayong ikonekta sa agent kung kailangan ninyo ng tulong.',
    },
  },
  KIND_DEF: {
    friendly: {
      vi: ['Mình rất tiếc vì anh/chị đang không hài lòng. 🙏 Mình thực sự muốn giúp. Anh/chị cho mình biết vấn đề là gì được không ạ? Mong chúng ta trao đổi lịch sự để mình hỗ trợ tốt hơn.', 'Mình hiểu anh/chị đang bực mình và xin lỗi vì sự bất tiện này. Để mình hỗ trợ ngay. Nếu muốn, anh/chị có thể nhấn “Gặp nhân viên hỗ trợ”.'],
      th: ['ขออภัยที่ทำให้คุณลูกค้ารู้สึกไม่สบายใจนะคะ 🙏 ดิฉันอยากช่วยจริงๆ ค่ะ รบกวนบอกได้ไหมคะว่าปัญหาคืออะไร และขอความกรุณาพูดคุยกันอย่างสุภาพเพื่อให้ดิฉันช่วยได้ดียิ่งขึ้นค่ะ', 'ดิฉันเข้าใจว่าคุณลูกค้ากำลังไม่พอใจ และขออภัยในความไม่สะดวกค่ะ ขอช่วยดำเนินการให้โดยเร็ว หากต้องการ สามารถกด “คุยกับเจ้าหน้าที่” ได้เลยค่ะ'],
      tl: ['Pasensya na po kung nahihirapan kayo ngayon. 🙏 Gusto ko po talagang tumulong. Maaari po bang sabihin ninyo kung ano ang problema? Sana po ay manatili tayong magalang para mas matulungan ko kayo.', 'Naiintindihan ko po na naiinis kayo at humihingi ako ng paumanhin sa abala. Tutulungan ko po kayo agad. Kung gusto ninyo, pindutin ang “Makipag-usap sa agent”.'],
    },
    formal: {
      vi: ['Chúng tôi xin lỗi vì sự bất tiện này. Chúng tôi rất muốn hỗ trợ quý khách. Xin quý khách vui lòng mô tả vấn đề. Mong cuộc trao đổi được giữ lịch sự.', 'Chúng tôi hiểu sự bất mãn của quý khách và xin lỗi. Chúng tôi sẽ hỗ trợ nhanh nhất có thể. Quý khách cũng có thể yêu cầu gặp nhân viên.'],
      th: ['เราขออภัยในความไม่สะดวก เรายินดีให้ความช่วยเหลือ กรุณาแจ้งรายละเอียดของปัญหา และขอความกรุณาสนทนาด้วยความสุภาพค่ะ', 'เราเข้าใจความไม่พอใจของคุณลูกค้าและขออภัยค่ะ เราจะช่วยเหลือให้เร็วที่สุด คุณลูกค้ายังสามารถขอคุยกับเจ้าหน้าที่ได้ด้วยค่ะ'],
      tl: ['Humihingi po kami ng paumanhin sa abala. Nais po naming kayong tulungan. Maaari po bang ilarawan ninyo ang problema? Hinihiling po namin na manatiling magalang ang usapan.', 'Naiintindihan po namin ang inyong pagkadismaya at humihingi kami ng paumanhin. Tutulungan po namin kayo sa lalong madaling panahon. Maaari rin po kayong humiling ng agent.'],
    },
  },
  REASK_TXT: {
    friendly: {
      vi: 'Xin lỗi, mình chưa hiểu rõ ý anh/chị 😅 Anh/chị nói rõ thêm giúp mình, hoặc chọn vấn đề cần hỗ trợ nhé?',
      th: 'ขออภัยค่ะ ดิฉันยังไม่เข้าใจ 😅 รบกวนอธิบายเพิ่มเติม หรือเลือกเรื่องที่ต้องการให้ช่วยได้เลยนะคะ',
      tl: 'Pasensya na po, hindi ko po masyadong naintindihan 😅 Maaari po bang ipaliwanag pa ninyo, o piliin ang kailangan ninyo?',
    },
    formal: {
      vi: 'Xin lỗi, chúng tôi chưa hiểu rõ tin nhắn của quý khách. Xin quý khách nói rõ thêm, hoặc chọn một trong các lựa chọn bên dưới.',
      th: 'ขออภัยค่ะ เรายังไม่เข้าใจข้อความของคุณลูกค้า กรุณาอธิบายเพิ่มเติม หรือเลือกจากตัวเลือกด้านล่างค่ะ',
      tl: 'Pasensya na po, hindi po namin lubos na naintindihan ang inyong mensahe. Maaari po bang ipaliwanag pa ninyo, o pumili sa mga opsyon sa ibaba?',
    },
  },
};
