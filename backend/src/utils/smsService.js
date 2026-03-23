const axios = require('axios');

const BASE_URL = 'https://api.msg91.com/api/v5';

/**
 * Send a fee receipt SMS after payment is recorded.
 */
const sendReceipt = async ({ phone, name, amount, receipt }) => {
  const message =
    `Dear Parent, fee of Rs.${amount} paid for ${name}. Receipt No: ${receipt}. - Akshara School`;

  return _send(phone, message, process.env.MSG91_TEMPLATE_RECEIPT);
};

/**
 * Send a fee due reminder SMS.
 */
const sendReminder = async ({ phone, name, balance }) => {
  const message =
    `Dear Parent, Rs.${balance} fee is pending for ${name}. Please pay at the earliest. - Akshara School`;

  return _send(phone, message, process.env.MSG91_TEMPLATE_REMINDER);
};

/**
 * Internal: send via MSG91 or log to console in development.
 */
const _send = async (phone, message, templateId) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[SMS DEV] To: ${phone} | ${message}`);
    return { status: 'dev_mock', phone, message };
  }

  const payload = {
    sender:      process.env.MSG91_SENDER_ID || 'AKSHRA',
    route:       '4',
    country:     '91',
    sms: [{
      message,
      to: [phone.replace(/\D/g, '')]
    }]
  };

  const { data } = await axios.post(`${BASE_URL}/flow/`, payload, {
    headers: {
      'authkey':      process.env.MSG91_AUTH_KEY,
      'content-type': 'application/json'
    }
  });

  return data;
};

module.exports = { sendReceipt, sendReminder };
