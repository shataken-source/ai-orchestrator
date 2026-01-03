/**
 * MATCH REPORT GENERATOR
 * Creates PDF reports for pet matches and sends via email
 */

const PDFDocument = require('pdfkit');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/**
 * Generate a PDF match report
 * @param {Object} matchData - Match information
 * @returns {Buffer} PDF buffer
 */
async function generateMatchReport(matchData) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'LETTER',
        margin: 50,
        info: {
          Title: `Pet Match Report - ${matchData.lostPet.pet_name}`,
          Author: 'PetReunion AI',
          Subject: 'Potential Pet Match Found',
          Creator: 'PetReunion Match Engine'
        }
      });

      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      doc.fontSize(24)
         .fillColor('#2563eb')
         .text('🐕 PetReunion', { align: 'center' })
         .fontSize(12)
         .fillColor('#6b7280')
         .text('AI-Powered Pet Matching System', { align: 'center' })
         .moveDown(0.5);

      // Match Score Banner
      const matchPercent = (matchData.similarity * 100).toFixed(1);
      doc.rect(50, doc.y, 512, 60)
         .fill('#10b981');
      doc.fillColor('#ffffff')
         .fontSize(28)
         .text(`${matchPercent}% MATCH`, 50, doc.y - 50, { align: 'center', width: 512 })
         .fontSize(12)
         .text('Potential Match Found!', { align: 'center', width: 512 });
      doc.moveDown(2);

      // Reset text color
      doc.fillColor('#1f2937');

      // Match Details Section
      doc.fontSize(16)
         .fillColor('#2563eb')
         .text('📋 Match Details', { underline: true })
         .moveDown(0.5);

      doc.fontSize(11)
         .fillColor('#374151')
         .text(`Match ID: ${matchData.matchId}`)
         .text(`Match Date: ${new Date().toLocaleDateString('en-US', { 
           weekday: 'long', 
           year: 'numeric', 
           month: 'long', 
           day: 'numeric' 
         })}`)
         .text(`Similarity Score: ${matchPercent}%`)
         .text(`Distance: ${matchData.distance ? matchData.distance.toFixed(1) + ' miles' : 'Unknown'}`)
         .moveDown(1);

      // Lost Pet Section
      doc.fontSize(16)
         .fillColor('#dc2626')
         .text('🔴 LOST PET', { underline: true })
         .moveDown(0.5);

      const lostPet = matchData.lostPet;
      doc.fontSize(11)
         .fillColor('#374151')
         .text(`Name: ${lostPet.pet_name || 'Unknown'}`)
         .text(`Type: ${lostPet.pet_type || 'Unknown'}`)
         .text(`Breed: ${lostPet.breed || 'Unknown'}`)
         .text(`Color: ${lostPet.color || 'Unknown'}`)
         .text(`Last Seen: ${lostPet.location_city || ''}, ${lostPet.location_state || ''}`)
         .text(`Date Lost: ${lostPet.date_lost || 'Unknown'}`)
         .text(`Description: ${(lostPet.description || 'No description').substring(0, 200)}...`)
         .moveDown(1);

      if (lostPet.photo_url) {
        doc.text(`Photo: ${lostPet.photo_url}`, { link: lostPet.photo_url });
        doc.moveDown(0.5);
      }

      // Found Pet Section
      doc.fontSize(16)
         .fillColor('#16a34a')
         .text('🟢 FOUND PET', { underline: true })
         .moveDown(0.5);

      const foundPet = matchData.foundPet;
      doc.fontSize(11)
         .fillColor('#374151')
         .text(`Name: ${foundPet.pet_name || 'Unknown'}`)
         .text(`Type: ${foundPet.pet_type || 'Unknown'}`)
         .text(`Breed: ${foundPet.breed || 'Unknown'}`)
         .text(`Color: ${foundPet.color || 'Unknown'}`)
         .text(`Found At: ${foundPet.location_city || ''}, ${foundPet.location_state || ''}`)
         .text(`Date Found: ${foundPet.date_lost || 'Unknown'}`)
         .text(`Description: ${(foundPet.description || 'No description').substring(0, 200)}...`)
         .moveDown(1);

      if (foundPet.photo_url) {
        doc.text(`Photo: ${foundPet.photo_url}`, { link: foundPet.photo_url });
        doc.moveDown(1);
      }

      // Side-by-Side Comparison Link
      doc.fontSize(14)
         .fillColor('#2563eb')
         .text('📸 View Side-by-Side Comparison:', { underline: true })
         .moveDown(0.3);

      const comparisonUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'https://petreunion.org'}/match/${matchData.lostPetId}/${matchData.foundPetId}`;
      doc.fontSize(11)
         .fillColor('#3b82f6')
         .text(comparisonUrl, { link: comparisonUrl })
         .moveDown(1.5);

      // Contact Information
      if (lostPet.owner_phone || lostPet.contact_phone) {
        doc.fontSize(14)
           .fillColor('#7c3aed')
           .text('📞 Owner Contact Information:', { underline: true })
           .moveDown(0.3);

        doc.fontSize(11)
           .fillColor('#374151');
        
        if (lostPet.owner_name) doc.text(`Name: ${lostPet.owner_name}`);
        if (lostPet.owner_phone) doc.text(`Phone: ${lostPet.owner_phone}`);
        if (lostPet.contact_phone) doc.text(`Alt Phone: ${lostPet.contact_phone}`);
        if (lostPet.owner_email) doc.text(`Email: ${lostPet.owner_email}`);
        doc.moveDown(1.5);
      }

      // Action Required Box
      doc.rect(50, doc.y, 512, 80)
         .fill('#fef3c7');
      doc.fillColor('#92400e')
         .fontSize(14)
         .text('⚠️ ACTION REQUIRED', 60, doc.y - 70, { width: 492 })
         .fontSize(11)
         .text('Please review this match and contact the pet owner if you believe this is their lost pet. Early reunification increases success rates significantly.', 60, doc.y + 5, { width: 492 });
      doc.moveDown(4);

      // Separator
      doc.strokeColor('#e5e7eb')
         .lineWidth(1)
         .moveTo(50, doc.y)
         .lineTo(562, doc.y)
         .stroke();
      doc.moveDown(1);

      // CTA Section
      doc.rect(50, doc.y, 512, 100)
         .fill('#eff6ff');
      
      const ctaY = doc.y - 90;
      doc.fillColor('#1e40af')
         .fontSize(14)
         .text('🚀 Manage Your Shelter with PetReunion AI', 60, ctaY, { width: 492, align: 'center' })
         .moveDown(0.5)
         .fontSize(11)
         .fillColor('#3730a3')
         .text('This match was found using PetReunion\'s AI-powered matching system.', 60, ctaY + 25, { width: 492, align: 'center' })
         .moveDown(0.5)
         .fontSize(12)
         .fillColor('#2563eb')
         .text('👉 Click here to manage your entire shelter inventory for FREE!', 60, ctaY + 50, { 
           width: 492, 
           align: 'center',
           link: 'https://petreunion.org/shelter/signup?utm_source=match_report&utm_medium=email'
         })
         .text('https://petreunion.org/shelter/signup', 60, ctaY + 70, { 
           width: 492, 
           align: 'center',
           link: 'https://petreunion.org/shelter/signup?utm_source=match_report&utm_medium=email'
         });

      doc.moveDown(5);

      // Footer
      doc.fontSize(9)
         .fillColor('#9ca3af')
         .text('This is an automated match report generated by PetReunion AI.', { align: 'center' })
         .text('Please verify the match before contacting pet owners.', { align: 'center' })
         .text(`Report generated: ${new Date().toISOString()}`, { align: 'center' });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Send match report via Sinch Email API
 * @param {string} toEmail - Recipient email
 * @param {string} shelterName - Shelter name
 * @param {Object} matchData - Match information
 * @param {Buffer} pdfBuffer - PDF report buffer
 */
async function sendMatchReportEmail(toEmail, shelterName, matchData, pdfBuffer) {
  const matchPercent = (matchData.similarity * 100).toFixed(1);
  
  // Email HTML body
  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #2563eb, #7c3aed); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; }
    .match-score { background: #10b981; color: white; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; margin: 20px 0; border-radius: 10px; }
    .pet-card { background: white; padding: 20px; margin: 15px 0; border-radius: 8px; border-left: 4px solid #2563eb; }
    .cta-box { background: #eff6ff; padding: 25px; text-align: center; margin: 25px 0; border-radius: 10px; border: 2px solid #2563eb; }
    .cta-button { display: inline-block; background: #2563eb; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 15px; }
    .footer { text-align: center; color: #6b7280; font-size: 12px; padding: 20px; }
    .highlight { color: #2563eb; font-weight: bold; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🐕 PetReunion AI</h1>
      <p>Potential Pet Match Found!</p>
    </div>
    
    <div class="content">
      <p>Dear ${shelterName || 'Shelter Team'},</p>
      
      <p>Our AI matching system has identified a <span class="highlight">potential match</span> between a lost pet and an animal in your care!</p>
      
      <div class="match-score">
        ${matchPercent}% Match
      </div>
      
      <div class="pet-card">
        <h3>🔴 Lost Pet: ${matchData.lostPet.pet_name || 'Unknown'}</h3>
        <p><strong>Type:</strong> ${matchData.lostPet.pet_type || 'Unknown'}<br>
        <strong>Breed:</strong> ${matchData.lostPet.breed || 'Unknown'}<br>
        <strong>Last Seen:</strong> ${matchData.lostPet.location_city || ''}, ${matchData.lostPet.location_state || ''}</p>
      </div>
      
      <div class="pet-card">
        <h3>🟢 Found Pet: ${matchData.foundPet.pet_name || 'Unknown'}</h3>
        <p><strong>Type:</strong> ${matchData.foundPet.pet_type || 'Unknown'}<br>
        <strong>Breed:</strong> ${matchData.foundPet.breed || 'Unknown'}<br>
        <strong>Location:</strong> ${matchData.foundPet.location_city || ''}, ${matchData.foundPet.location_state || ''}</p>
      </div>
      
      <p>📎 <strong>A detailed PDF report is attached</strong> with side-by-side comparison photos and owner contact information.</p>
      
      <div class="cta-box">
        <h3>🚀 This match was found using PetReunion's AI</h3>
        <p>Our AI scans thousands of lost pet listings daily to find matches for shelter animals.</p>
        <p><strong>Want to reunite more pets with their families?</strong></p>
        <a href="https://petreunion.org/shelter/signup?utm_source=match_email&utm_medium=email&utm_campaign=shelter_acquisition" class="cta-button">
          Manage Your Entire Shelter Inventory for FREE →
        </a>
        <p style="margin-top: 15px; font-size: 12px; color: #6b7280;">
          Free features: AI matching • Lost pet alerts • Shelter dashboard • SMS notifications
        </p>
      </div>
      
      <p>Please review this match and contact the pet owner if you believe this is their lost pet.</p>
      
      <p>Best regards,<br>
      <strong>The PetReunion AI Team</strong></p>
    </div>
    
    <div class="footer">
      <p>This is an automated message from PetReunion AI Matching System.<br>
      Match ID: ${matchData.matchId} | Generated: ${new Date().toISOString()}</p>
      <p><a href="https://petreunion.org/unsubscribe?email=${encodeURIComponent(toEmail)}">Unsubscribe</a> | 
      <a href="https://petreunion.org/privacy">Privacy Policy</a></p>
    </div>
  </div>
</body>
</html>
  `;

  // Plain text version
  const textBody = `
PetReunion AI - Potential Pet Match Found!

Dear ${shelterName || 'Shelter Team'},

Our AI matching system has identified a potential match between a lost pet and an animal in your care!

MATCH SCORE: ${matchPercent}%

LOST PET: ${matchData.lostPet.pet_name || 'Unknown'}
- Type: ${matchData.lostPet.pet_type || 'Unknown'}
- Breed: ${matchData.lostPet.breed || 'Unknown'}
- Last Seen: ${matchData.lostPet.location_city || ''}, ${matchData.lostPet.location_state || ''}

FOUND PET: ${matchData.foundPet.pet_name || 'Unknown'}
- Type: ${matchData.foundPet.pet_type || 'Unknown'}
- Breed: ${matchData.foundPet.breed || 'Unknown'}
- Location: ${matchData.foundPet.location_city || ''}, ${matchData.foundPet.location_state || ''}

A detailed PDF report is attached with photos and owner contact information.

---

This match was found using PetReunion's AI.
Click here to manage your entire shelter inventory for FREE:
https://petreunion.org/shelter/signup

---

Please review this match and contact the pet owner if appropriate.

Best regards,
The PetReunion AI Team

Match ID: ${matchData.matchId}
Generated: ${new Date().toISOString()}
  `;

  // Try Sinch Email API first, then fallback to other services
  if (process.env.SINCH_EMAIL_API_KEY) {
    return await sendViaSinchEmail(toEmail, shelterName, matchData, pdfBuffer, htmlBody, textBody);
  } else if (process.env.SENDGRID_API_KEY) {
    return await sendViaSendGrid(toEmail, shelterName, matchData, pdfBuffer, htmlBody, textBody);
  } else if (process.env.RESEND_API_KEY) {
    return await sendViaResend(toEmail, shelterName, matchData, pdfBuffer, htmlBody, textBody);
  } else {
    console.warn('[Match Report] No email service configured');
    return { success: false, error: 'No email service configured' };
  }
}

/**
 * Send email via Sinch Email API
 */
async function sendViaSinchEmail(toEmail, shelterName, matchData, pdfBuffer, htmlBody, textBody) {
  try {
    const url = 'https://mail.api.sinch.com/v1/send';
    
    const formData = new FormData();
    formData.append('from', process.env.SINCH_EMAIL_FROM || 'matches@petreunion.org');
    formData.append('to', toEmail);
    formData.append('subject', `🐕 Pet Match Found! ${(matchData.similarity * 100).toFixed(0)}% Match for ${matchData.lostPet.pet_name || 'a Lost Pet'}`);
    formData.append('html', htmlBody);
    formData.append('text', textBody);
    formData.append('attachment', new Blob([pdfBuffer], { type: 'application/pdf' }), `PetReunion-Match-Report-${matchData.matchId}.pdf`);

    const response = await axios.post(url, formData, {
      headers: {
        'Authorization': `Bearer ${process.env.SINCH_EMAIL_API_KEY}`,
        'Content-Type': 'multipart/form-data'
      }
    });

    console.log(`[Match Report] ✅ Email sent via Sinch to ${toEmail}`);
    return { success: true, messageId: response.data.id };
  } catch (error) {
    console.error(`[Match Report] ❌ Sinch email failed:`, error.response?.data || error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Send email via SendGrid (fallback)
 */
async function sendViaSendGrid(toEmail, shelterName, matchData, pdfBuffer, htmlBody, textBody) {
  try {
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);

    const msg = {
      to: toEmail,
      from: process.env.SENDGRID_FROM || 'matches@petreunion.org',
      subject: `🐕 Pet Match Found! ${(matchData.similarity * 100).toFixed(0)}% Match for ${matchData.lostPet.pet_name || 'a Lost Pet'}`,
      text: textBody,
      html: htmlBody,
      attachments: [{
        content: pdfBuffer.toString('base64'),
        filename: `PetReunion-Match-Report-${matchData.matchId}.pdf`,
        type: 'application/pdf',
        disposition: 'attachment'
      }]
    };

    const response = await sgMail.send(msg);
    console.log(`[Match Report] ✅ Email sent via SendGrid to ${toEmail}`);
    return { success: true, messageId: response[0].headers['x-message-id'] };
  } catch (error) {
    console.error(`[Match Report] ❌ SendGrid failed:`, error.response?.body || error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Send email via Resend (fallback)
 */
async function sendViaResend(toEmail, shelterName, matchData, pdfBuffer, htmlBody, textBody) {
  try {
    const response = await axios.post('https://api.resend.com/emails', {
      from: process.env.RESEND_FROM || 'matches@petreunion.org',
      to: toEmail,
      subject: `🐕 Pet Match Found! ${(matchData.similarity * 100).toFixed(0)}% Match for ${matchData.lostPet.pet_name || 'a Lost Pet'}`,
      html: htmlBody,
      text: textBody,
      attachments: [{
        filename: `PetReunion-Match-Report-${matchData.matchId}.pdf`,
        content: pdfBuffer.toString('base64')
      }]
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    console.log(`[Match Report] ✅ Email sent via Resend to ${toEmail}`);
    return { success: true, messageId: response.data.id };
  } catch (error) {
    console.error(`[Match Report] ❌ Resend failed:`, error.response?.data || error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Get shelter email from directory
 */
async function getShelterEmail(foundPet) {
  // Try to find shelter in directory
  if (foundPet.shelter_id) {
    const { data: shelter } = await supabase
      .from('shelters_directory')
      .select('email, name')
      .eq('id', foundPet.shelter_id)
      .single();
    
    if (shelter?.email) {
      return { email: shelter.email, name: shelter.name };
    }
  }

  // Try by owner name (for shelter entries)
  if (foundPet.owner_name && foundPet.owner_name !== 'Unknown') {
    const { data: shelter } = await supabase
      .from('shelters_directory')
      .select('email, name')
      .ilike('name', `%${foundPet.owner_name}%`)
      .limit(1)
      .single();
    
    if (shelter?.email) {
      return { email: shelter.email, name: shelter.name };
    }
  }

  // Try by location
  if (foundPet.location_city && foundPet.location_state) {
    const { data: shelters } = await supabase
      .from('shelters_directory')
      .select('email, name')
      .ilike('city', `%${foundPet.location_city}%`)
      .eq('state', foundPet.location_state)
      .limit(1);
    
    if (shelters?.[0]?.email) {
      return { email: shelters[0].email, name: shelters[0].name };
    }
  }

  return null;
}

/**
 * Update match status to shelter_notified
 */
async function updateMatchStatus(matchId, status, notificationDetails = {}) {
  const { error } = await supabase
    .from('pet_matches')
    .update({
      status: status,
      notified_at: new Date().toISOString(),
      notification_details: notificationDetails,
      updated_at: new Date().toISOString()
    })
    .eq('id', matchId);

  if (error) {
    console.error(`[Match Report] Failed to update match status:`, error);
    return false;
  }

  console.log(`[Match Report] ✅ Match ${matchId} status updated to: ${status}`);
  return true;
}

/**
 * Process and send match report (main function)
 */
async function processMatchReport(matchId) {
  console.log(`\n📋 [Match Report] Processing match ${matchId}...`);

  // Get match details
  const { data: match, error: matchError } = await supabase
    .from('pet_matches')
    .select('*')
    .eq('id', matchId)
    .single();

  if (matchError || !match) {
    console.error(`[Match Report] Match not found: ${matchId}`);
    return { success: false, error: 'Match not found' };
  }

  // Get pet details
  const [lostPetResult, foundPetResult] = await Promise.all([
    supabase.from('lost_pets').select('*').eq('id', match.lost_pet_id).single(),
    supabase.from('lost_pets').select('*').eq('id', match.found_pet_id).single()
  ]);

  if (!lostPetResult.data || !foundPetResult.data) {
    console.error(`[Match Report] Pet data not found`);
    return { success: false, error: 'Pet data not found' };
  }

  const matchData = {
    matchId: matchId,
    lostPetId: match.lost_pet_id,
    foundPetId: match.found_pet_id,
    similarity: match.similarity_score,
    distance: match.distance_miles,
    lostPet: lostPetResult.data,
    foundPet: foundPetResult.data
  };

  // Get shelter email
  const shelterInfo = await getShelterEmail(matchData.foundPet);
  
  if (!shelterInfo?.email) {
    console.warn(`[Match Report] No shelter email found for match ${matchId}`);
    await updateMatchStatus(matchId, 'no_shelter_email', { reason: 'Shelter email not found' });
    return { success: false, error: 'No shelter email found' };
  }

  console.log(`[Match Report] Sending to shelter: ${shelterInfo.name} (${shelterInfo.email})`);

  // Generate PDF
  const pdfBuffer = await generateMatchReport(matchData);
  console.log(`[Match Report] PDF generated: ${pdfBuffer.length} bytes`);

  // Send email
  const emailResult = await sendMatchReportEmail(
    shelterInfo.email,
    shelterInfo.name,
    matchData,
    pdfBuffer
  );

  if (emailResult.success) {
    // Update status to shelter_notified
    await updateMatchStatus(matchId, 'shelter_notified', {
      shelter_email: shelterInfo.email,
      shelter_name: shelterInfo.name,
      message_id: emailResult.messageId,
      sent_at: new Date().toISOString()
    });

    console.log(`[Match Report] ✅ Report sent successfully to ${shelterInfo.email}`);
    return { success: true, email: shelterInfo.email };
  } else {
    await updateMatchStatus(matchId, 'notification_failed', {
      error: emailResult.error,
      attempted_at: new Date().toISOString()
    });

    return { success: false, error: emailResult.error };
  }
}

module.exports = {
  generateMatchReport,
  sendMatchReportEmail,
  processMatchReport,
  updateMatchStatus,
  getShelterEmail
};

