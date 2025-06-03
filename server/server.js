/**
 * call to PMS to fetch relevant check-in and check-out events.
 * call to crm to store the response details.
 */
const crmDomain = 'indiestays-in.myfreshworks.com';
const  api_key = 'gh8ZNFhGfG_yf8mW63LkHQ';
const crmBasePath = "/crm/sales/api/";
let crmPath = "";
const wifiAuth = "YWRtaW5pc3RyYXRvcjphZG1pbmlzdHJhdG9y";
const fetchToken = "MzRjYzc2ZTktZTVkNS00ZWI1LWFkNmQtZWEyOTQ0Mzc5NTBmOjc3YzA2NDYwLWQxNGEtNDI2Yi05Y2U3LTY0YTViOThhYzM1MQ==";

exports = {
  onAppInstallHandler: async function () {
    const datetime = new Date();

    try {
      console.info('onAppInstallHandler invoked');

      const data = await $schedule.create({
        name: "Scheduled call to HK",
        data: { event_info: "app_install" },
        schedule_at: datetime,
        repeat: {
          time_unit: "minutes",
          frequency: 20
        }
      });

      console.info("Schedule created:", JSON.stringify(data));
    } catch (error) {
      console.error("Error creating schedule:", error);
    }

    try {
      const datetime = new Date();
      const updated = await $schedule.update({
        name: "Scheduled call to HK",
        data: { event_info: "app_install" },
        schedule_at: datetime,
        repeat: {
          time_unit: "minutes",
          frequency: 15
        }
      });

      console.info("Schedule updated:", JSON.stringify(updated));
    } catch (error) {
      console.error("Error updating schedule:", error);
    }

    renderData();
  },

  onScheduledEventHandler: async function () {
     try {
      const res = await $request.invokeTemplate("getLeads", {
        context: { encodedToken: fetchToken }
      });

      const hkArray = JSON.parse(res.response);
      console.info("HotelKey Response:", hkArray);

      for (const event of hkArray) {
        const reservation = event.payload?.reservation;
        const propertyCode = event.payload?.property_code;
        console.info(reservation.reservation_no, "--inside for..", event);
        // post_check_in_room_number_changed - this is another event in wifi software.
          if (propertyCode === '7004') {
            if (reservation && reservation.guest_info) {
              let changeEvents = event.payload?.change_events;
              cEvent = "";
              cEvent = getChangeEvents(changeEvents, ["reservation_checked_in"]);
              console.info("cEvent", cEvent);
              if(reservation.booking_status === "CHECKED_IN" && cEvent === true){
                await handleCheckIn(reservation);
                // await handleCheckOut(reservation, wifiAuth);
              }else{
                //acknowledge poll
                console.log(`Skipping check-in. Booking status is '${reservation.booking_status}'`);
              }
            }else{
              //acknowledge poll
              console.info("Skipping invalid reservation payload:", event);
            }
        }else{
          //acknowledge poll
          console.info(`Skipping event due to unmatched property_code: ${propertyCode}`);
        }
      }
    } catch (error) {
      console.error("Error in onScheduledEventHandler:", error);
    }
  }
};

const generateUniqueCode = () => {
  let code;
  code = Math.floor(Math.random() * 9000) + 1000;
  return code;
};

// CRM Search by Phone
async function searchContact(params) {
  try{
    const mobileNumber = params.replace(/\s+/g, "");
    const contactDet = await $request.invokeTemplate("getContact", {
      body: JSON.stringify({ "filter_rule" : [{"attribute" : "mobile_number", "operator":"is_in", "value":mobileNumber}] }),
      context: {
        domain : crmDomain,
        path : crmBasePath + "filtered_search/contact",
        api_key : api_key
      }
    });
    // console.info("contactDet", contactDet);
    const response = await contactDet.response;
    if(typeof response === "undefined" || response === null || response === '')
      {
        return Promise.reject({"status" : "failure", "message":"could not search contact, check error logs.."});
      }else{
        return Promise.resolve({"status":"success","message":"contact search completed", "data": JSON.parse(contactDet.response)});
      }
  }catch(error){
    return Promise.reject({"status" : "failure", "message":"cached error while searching contact..", "data": error});
  }
}

// CRM Update Full Contact by ID
async function updateCrmContactFields(contactId, updatePayload) {
    conUPath = crmBasePath + "contacts/"+contactId;
    try{
      /********calling api to update data to crm******/
      conResponse =  await $request.invokeTemplate("updateCrmContactFields", {
        context: {
          path : conUPath,
          domain : crmDomain,
          api_key : api_key
        },
        body: JSON.stringify(updatePayload)
      });
      console.info('contactObj--', updatePayload);          

      // console.info('contact response--', conResponse);
      if(typeof conResponse === 'undefined' || conResponse === null){
      return Promise.reject({"status":"failed", "message":"contact could not be processed, check error logs..", "data":conResponse});
      }else{
        const conResObj = JSON.parse(conResponse.response);
        return Promise.resolve({"status":"success","message":"contact is processed..", "data":conResObj});
      }
    }catch(error){
    // console.info("error from handleContact", error);
    return Promise.reject({"status":"failure", "message":"cached error", "data":error});
    }
}

// Check-In Logic
async function handleCheckIn(reservation) {
  try {
      const actualCheckIn = reservation.actual_check_in ? reservation.actual_check_in.split('T') : [];
      const date = actualCheckIn.length > 0 ? actualCheckIn[0].slice(2).replace(/-/g, '') : '';
      const time = actualCheckIn.length > 1 ? actualCheckIn[1].split('.')[0].replace(/:/g, '') : '';
      const mobileNumber = reservation.guest_info.phone;
      let updatePayload = {};
      let guestshare = "N";

      // 1. Perform check-in for all adults, build updatePayload for CRM update later
      for (let i = 0; i < reservation.adult_count; i++) {
        guestshare = i === 0 ? "N" : "Y";
        const uniqueCode = generateUniqueCode();
        const registrationWithCode = `${reservation.reservation_no}${uniqueCode}`;
        let identifier =  reservation.room_number + registrationWithCode;

        const checkInPayload = {
          "roomno": reservation.room_number,
          "registrationno": registrationWithCode,
          "guestshare": guestshare,
          "guestname": `${reservation.guest_info.first_name} ${reservation.guest_info.last_name}`,
          "firstname": reservation.guest_info.first_name,
          "date": date,
          "time": time
        };
        console.log(identifier, " ==> Sending Check-In Payload:", checkInPayload);
        try{
            const checkInResponse = await $request.invokeTemplate("checkInGuest", {
              context: { Wifi_auth: wifiAuth },
              body: JSON.stringify(checkInPayload)
            });

            console.info(identifier, "==> checkin wifi response ", checkInResponse);

            const index = i + 1;
            const regField = `cf_wifi_reg_no_${index}`;
            const flagField = `cf_wifi_checkin_flag${index}`;
            const commentField = `cf_wifi_checkin_comment${index}`;

            const cRes = JSON.parse(checkInResponse.response);
            if(cRes.responsecode === 1){
              console.info(` Check-In Success for Adult ${index}`);
              updatePayload[regField] = registrationWithCode;
              updatePayload[flagField] = true;
              updatePayload[commentField] = "WiFi enabled";
            }else{
              console.info(` WiFi check-in failed for Adult ${index}`);
              updatePayload[regField] = registrationWithCode;
              updatePayload[flagField] = false;
              updatePayload[commentField] = `Error: ${cRes.message}`;
            }
            await searchCrmContactByPhone(mobileNumber).then(async scObj =>{
                if(scObj.status === "success"){ 
                  console.info(key, "==>", scObj.status, scObj.message, scObj.data); 
                  let contact = await scObj.data;
                  let isEmptyCon = isEmpty(contact, "contacts");
                  // console.info('isEmpty...', isEmptyCon);
                  if(isEmptyCon === true){
                    //contact not found 
                    console.info(identifier, "==> skipping process as contact not found");
                  }else{
                    //update contact
                    const contactId = contact.contacts[0].id;
                    updateCrmContactFields(contactId, updatePayload);
                  }
                }
              });
            
          }catch(error) {
              console.info(identifier, "==> catched error while checking in..", error)
            }
          }
        
      // 2. After all check-ins, search CRM contact by phone number
      // const crmData = await searchCrmContactByPhone(mobileNumber);

      // if (!crmData || crmData.length === 0) {
      //   console.info(`No CRM contact found. Skipping CRM update for reservation: ${reservation.reservation_no}`);
      //   // No contact found, stop further processing
      //   return;
      // } else {
      //   // CRM data found, now check if contact with ID exists for this phone number
      //   const crmContact = crmData.find(contact => contact.phone_number === mobileNumber);

      //   if (!crmContact || !crmContact.id) {
      //     console.info(`CRM contact not found or missing ID for phone number: ${mobileNumber}. Aborting CRM update.`);
      //     // Contact missing or no ID, stop processing
      //     return;
      //   } else {
      //     // Contact with valid ID found, proceed with update
      //     const contactId = crmContact.id;
      //     const crmUpdateResponse = await updateCrmContactFields(contactId, updatePayload, crmAuth);
      //     console.info("CRM Contact Updated:", crmUpdateResponse);
      //   }
      // }
  }catch (error) {
    console.error("Error in Check-In process:", error);
  }
}

// Check-Out Logic
async function handleCheckOut(reservation, wifiAuth) {
  try {
    if (reservation.booking_status === 'CHECKED_OUT') {
      const actualCheckOut = reservation.actual_check_out ? reservation.actual_check_out.split('T') : [];
      const date = actualCheckOut.length > 0 ? actualCheckOut[0].slice(2).replace(/-/g, '') : '';
      const time = actualCheckOut.length > 1 ? actualCheckOut[1].split('.')[0].replace(/:/g, '') : '';

      const mobileNumber = reservation.guest_info.phone;
      const crmData = await searchCrmContactByPhone(mobileNumber);

      if (crmData && crmData.length > 0) {
        const crmContact = crmData.find(contact => contact.phone_number === mobileNumber);

        if (crmContact) {
          const registrationNo = crmContact.registrationno;

          if (registrationNo.startsWith(reservation.reservation_no)) {
            for (let i = 0; i < reservation.adult_count; i++) {
              const guestshare = i === 0 ? "N" : "Y";

              const checkOutPayload = {
                "roomno": reservation.room_number,
                "registrationno": registrationNo,
                "guestshare": guestshare,
                "date": date,
                "time": time
              };
              console.log(checkOutPayload);


              const checkOutResponse = await $request.invokeTemplate("checkOutGuest", {
                context: { Wifi_auth: wifiAuth },
                body: JSON.stringify(checkOutPayload) // Sending payload in body
              });

              console.info("Check-Out Success:", checkOutResponse);
            }
          } else {
            console.info("CRM registration number doesn't match reservation prefix.");
          }
        } else {
          console.info("No matching CRM contact for check-out.");
        }
      } else {
        console.info("No CRM data found for phone number during check-out.");
      }
    } else {
      console.log(`Skipping check-out. Booking status is '${reservation.booking_status}'`);
    }
  } catch (error) {
    console.error("Check-Out Error:", error);
  }
}

function getChangeEvents(data, events){
  let status = false;
  for(i=0; i <= events.length; i++){
    if (Object.values(data).indexOf(events[i]) > -1) {
      console.info("event found..", data);
      status = true;
      break
    }else{
      console.info("event not found..", data);
      status = false;
      continue
    }
  }
  console.info(status);
  return status;
}

async function ackPoll(pollData){
  const handle = {"receipt_handle" : pollData.reciept};

  // console.info('pollData', pollData);
    try{

    const res =  await $request.invokeTemplate("acknowledgePoll", {
      context: {
        encondedToken : pollData.token
      },
      body : JSON.stringify(handle)
    });
    // console.info('acknowledge res--',res);
    const hkRes =  await res.status;
    return Promise.resolve({"status":"success","message":"poll acknowledged", "data":hkRes});
  }catch(error){
    return Promise.reject({"status":"failed", "message":"Cached error while acknoleding poll", "data":error});
  }
}

function isEmpty(obj, objName) {
  // console.info('keys', obj, objName, obj[objName], typeof objName);
  const keyLen = Object.keys(obj[objName]).length;
  if(keyLen === 0){
    return true;
  }else{
    return false;
  }
}