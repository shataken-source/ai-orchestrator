/**
 * PET MATCH ENGINE
 * 24/7 vector comparison for lost/found pet matching
 */

const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const cron = require('node-cron');
const { processMatchReport } = require('./match-report-generator');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Configuration
const CONFIG = {
  MATCH_THRESHOLD: 0.85, // Cosine similarity threshold (0-1)
  BATCH_SIZE: 50, // Process N pets at a time
  CHECK_INTERVAL: 5, // Minutes between checks
  MAX_DISTANCE_MILES: 50, // Max distance for matches
};

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(vec1, vec2) {
  if (!vec1 || !vec2 || vec1.length !== vec2.length) {
    return 0;
  }
  
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  
  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    norm1 += vec1[i] * vec1[i];
    norm2 += vec2[i] * vec2[i];
  }
  
  norm1 = Math.sqrt(norm1);
  norm2 = Math.sqrt(norm2);
  
  if (norm1 === 0 || norm2 === 0) return 0;
  
  return dotProduct / (norm1 * norm2);
}

/**
 * Calculate distance between two locations (Haversine formula)
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return Infinity;
  
  const R = 3959; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Find matches for a lost pet
 */
async function findMatchesForLostPet(lostPet) {
  if (!lostPet.image_vectors || lostPet.image_vectors.length === 0) {
    return [];
  }
  
  // Get all found pets with vectors
  const { data: foundPets, error } = await supabase
    .from('lost_pets')
    .select('*')
    .eq('status', 'found')
    .not('image_vectors', 'is', null)
    .limit(1000);
  
  if (error || !foundPets) {
    console.error('[Match Engine] Error fetching found pets:', error);
    return [];
  }
  
  const matches = [];
  
  for (const foundPet of foundPets) {
    if (!foundPet.image_vectors || foundPet.image_vectors.length === 0) continue;
    
    // Compare all vectors from lost pet with all vectors from found pet
    let maxSimilarity = 0;
    
    for (const lostVector of lostPet.image_vectors) {
      for (const foundVector of foundPet.image_vectors) {
        const similarity = cosineSimilarity(lostVector, foundVector);
        maxSimilarity = Math.max(maxSimilarity, similarity);
      }
    }
    
    // Check distance
    const distance = calculateDistance(
      lostPet.location_lat,
      lostPet.location_lon,
      foundPet.location_lat,
      foundPet.location_lon
    );
    
    // Check if match meets threshold
    if (maxSimilarity >= CONFIG.MATCH_THRESHOLD && distance <= CONFIG.MAX_DISTANCE_MILES) {
      matches.push({
        foundPetId: foundPet.id,
        foundPetName: foundPet.pet_name,
        similarity: maxSimilarity,
        distance: distance,
        foundPet: foundPet
      });
    }
  }
  
  // Sort by similarity (highest first)
  matches.sort((a, b) => b.similarity - a.similarity);
  
  return matches;
}

/**
 * Send SMS notification to pet owner
 */
async function sendMatchNotification(lostPet, match) {
  if (!process.env.SINCH_API_TOKEN || !process.env.SINCH_SERVICE_PLAN_ID) {
    console.warn('[Match Engine] SMS not configured, skipping notification');
    return;
  }
  
  const ownerPhone = lostPet.owner_phone || lostPet.contact_phone;
  if (!ownerPhone) {
    console.warn(`[Match Engine] No phone number for pet ${lostPet.id}`);
    return;
  }
  
  const message = `🐕 PET MATCH FOUND!

Your pet "${lostPet.pet_name}" may have been found!

Match Score: ${(match.similarity * 100).toFixed(1)}%
Distance: ${match.distance.toFixed(1)} miles
Found Pet: ${match.foundPetName}

View details: ${process.env.NEXT_PUBLIC_BASE_URL || 'https://petreunion.org'}/match/${lostPet.id}/${match.foundPetId}

This is an automated match - please verify before contacting.`;

  try {
    const url = `https://sms.api.sinch.com/xms/v1/${process.env.SINCH_SERVICE_PLAN_ID}/batches`;
    
    await axios.post(url, {
      from: process.env.SINCH_NUMBER || process.env.SINCH_FROM,
      to: [ownerPhone],
      body: message
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.SINCH_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`[Match Engine] ✅ SMS sent to ${ownerPhone} for match ${match.foundPetId}`);
  } catch (error) {
    console.error(`[Match Engine] ❌ Failed to send SMS:`, error.response?.data || error.message);
  }
}

/**
 * Save match to database and return the match ID
 */
async function saveMatch(lostPetId, foundPetId, similarity, distance) {
  const { data, error } = await supabase.from('pet_matches').insert({
    lost_pet_id: lostPetId,
    found_pet_id: foundPetId,
    similarity_score: similarity,
    distance_miles: distance,
    status: 'pending',
    created_at: new Date().toISOString()
  }).select('id').single();
  
  if (error) {
    console.error(`[Match Engine] Failed to save match:`, error);
    return null;
  }
  
  return data.id;
}

/**
 * Check if match already exists
 */
async function matchExists(lostPetId, foundPetId) {
  const { data } = await supabase
    .from('pet_matches')
    .select('id')
    .eq('lost_pet_id', lostPetId)
    .eq('found_pet_id', foundPetId)
    .limit(1)
    .single();
  
  return !!data;
}

/**
 * Process matches for all lost pets
 */
async function processMatches() {
  console.log('\n🔍 [Match Engine] Starting match scan...');
  
  // Get all lost pets with vectors
  const { data: lostPets, error } = await supabase
    .from('lost_pets')
    .select('*')
    .eq('status', 'lost')
    .not('image_vectors', 'is', null)
    .limit(CONFIG.BATCH_SIZE);
  
  if (error || !lostPets) {
    console.error('[Match Engine] Error fetching lost pets:', error);
    return;
  }
  
  console.log(`[Match Engine] Checking ${lostPets.length} lost pets...`);
  
  let totalMatches = 0;
  let notificationsSent = 0;
  
  for (const lostPet of lostPets) {
    try {
      const matches = await findMatchesForLostPet(lostPet);
      
      for (const match of matches) {
        // Check if match already exists
        const exists = await matchExists(lostPet.id, match.foundPetId);
        if (exists) {
          continue;
        }
        
        // Save match and get ID
        const matchId = await saveMatch(
          lostPet.id,
          match.foundPetId,
          match.similarity,
          match.distance
        );
        
        if (matchId) {
          totalMatches++;
          
          // Send SMS notification to owner
          await sendMatchNotification(lostPet, match);
          notificationsSent++;
          
          // Generate and send PDF report to shelter via email
          try {
            const reportResult = await processMatchReport(matchId);
            if (reportResult.success) {
              console.log(`[Match Engine] 📧 PDF report sent to shelter: ${reportResult.email}`);
            }
          } catch (reportError) {
            console.error(`[Match Engine] Failed to send PDF report:`, reportError.message);
          }
          
          console.log(`[Match Engine] ✅ Match found: ${lostPet.pet_name} ↔ ${match.foundPetName} (${(match.similarity * 100).toFixed(1)}%)`);
        }
      }
    } catch (error) {
      console.error(`[Match Engine] Error processing pet ${lostPet.id}:`, error);
    }
  }
  
  console.log(`[Match Engine] Complete: ${totalMatches} new matches, ${notificationsSent} notifications sent\n`);
}

/**
 * Start the match engine (24/7)
 */
function startMatchEngine() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║         🐕 PET MATCH ENGINE - STARTING                     ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log(`   Match Threshold: ${CONFIG.MATCH_THRESHOLD * 100}%`);
  console.log(`   Max Distance: ${CONFIG.MAX_DISTANCE_MILES} miles`);
  console.log(`   Check Interval: ${CONFIG.CHECK_INTERVAL} minutes`);
  console.log('');
  
  // Run immediately
  processMatches();
  
  // Then run on schedule
  cron.schedule(`*/${CONFIG.CHECK_INTERVAL} * * * *`, async () => {
    await processMatches();
  });
  
  console.log(`✅ Match engine running - checking every ${CONFIG.CHECK_INTERVAL} minutes`);
}

module.exports = {
  startMatchEngine,
  processMatches,
  findMatchesForLostPet,
  cosineSimilarity
};

