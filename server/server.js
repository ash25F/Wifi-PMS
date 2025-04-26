
const crmDomain = 'indiestays-in.myfreshworks.com';
const  api_key = 'gh8ZNFhGfG_yf8mW63LkHQ';
// const crmDomain = 'trial-833279742723219531.myfreshworks.com';
// const  api_key = '7LB1zrNtmilr_IiHGmc4SQ';
const crmBasePath = "/crm/sales/api/";
let crmPath = "";

exports = {

  onAppInstallHandler: async function () {
    const datetime = new Date();
        try{
        console.info('onAppInstallHandler invoked \n');
        //console.log('datetime', datetime);
        const data = await $schedule.create({
          name: "Scheduled call to HK",
          data: {
            "event_info": "app_install"
          },
          schedule_at: datetime,
          repeat: {
             time_unit: "minutes",
            frequency: 30
          }
        });
        console.log("Schedule created: \n", JSON.stringify(data));
      }catch(error){
        console.info("catched error while creating schedule...",error);
      }
      try {
        const upData = await $schedule.update({
          name: "Scheduled call to HK",
          data: {
            "event_info": "app_install"
          },
          schedule_at: datetime,
          repeat: {
            time_unit: "minutes",
            frequency: 20
          }
        });
        console.log("Schedule updated: \n", JSON.stringify(upData))
      }
      catch (error) {
        console.log("catched error while updating schedule...", error)
      }
    renderData();
  },
   
    onScheduledEventHandler: async function () {
      try{
          /***get territories***/
          const territories = await getTerritories();
          const logs = {};
          // console.info('territories -----', territories);
          //*****************************call for hk API start *******************/
          const token = "OWE1YzBmMTYtMWIwNy00M2RjLTk0NjgtYWI2NTU3NGU1OTRhOjQzNTg5OTJjLTNhNDYtNDUyMy05Mzc2LThkOWNmZGRlNjFiNw==";
          const res =  await $request.invokeTemplate("getLeads", {
            context: {
              encondedToken : token
            }
          });
          const hkRes =  JSON.parse(res.response);
          // console.info("hkRes--", hkRes);
          hkRes.forEach(async (resItem, index) => {
            let log_chunk = {};
            let reservation_no = "";
            try{
              
              // console.info("resItem--", index, resItem);
            let hkData = resItem["payload"];
            let bkData = {"token" : token,"reciept" : resItem.receipt_handle};
            reservation_no = hkData.reservation.reservation_no;
            booking_status = hkData.reservation.booking_status;
            // const propShortCode = territories[hkData.property_code].short_code;
            //*****************************call for hk API end *******************/
            // console.info('hk response----', hkData, 'bkData...', hkData.reservation.reservation_no);

            if(hkData.stream_name ==='Indiestays_Reservation')
            { //if the data is related to Indiestays
                  console.info('stream id is correct');
                  if(hkData.reservation.booking_status === 'BOOKED')
                  {//*****booking event******/
                    let contMobile = hkData.reservation.guest_info.phone;
                    console.info(index, "mobile number check...",typeof contMobile,  contMobile);
                    if(typeof contMobile === "undefined" || contMobile === null || contMobile === '' || contMobile === "''")
                      {
                        // console.info("process aborted as mobile number for contact is not available");
                        let acknowledgedBk = await ackPoll(bkData);
                        console.info("Poll Acknowledged...",acknowledgedBk);
                        log_chunk = {'status': "failed", 'message': 'process aborted as mobile number for contact is not available'};
                      }else{
                        if(contMobile.length > 10){
                              let booking = await handleBooking(hkData, territories);
                              // console.info('new booking created...',booking);
                              if(typeof booking === 'undefined' || booking === null){
                                console.info("booking could not be created, check error logs..");
                                log_chunk = {"message":"booking could not be created, check error logs.."};
                              }else{
                                acknowledgedBk = await ackPoll(bkData);
                                console.info("Poll Acknowledged after booking creation...",acknowledgedBk);
                                log_chunk = {'status' : booking.status};
                              }
                            }else{
                              // console.info("mobile number length doesn't meet the criteria..");
                              acknowledgedBk = await ackPoll(bkData);
                              console.info("Poll Acknowledged...",acknowledgedBk);
                              log_chunk = {'status': "failed", 'message': "mobile number length doesn't meet the criteria."};
                            }
                    }
                  }else{
                    log_chunk = {"booking status": booking_status};
                  }
              }
            }catch(error){
              console.error('error from inner block handler--',error);
              log_chunk = {"error catched": error};
            }
            logs[reservation_no] = log_chunk;
            console.info("logs--", logs);
      });
    }catch(error){
      console.error('error from outer scheduled event handler--', error);
    }
  }
}

async function getSources(){
    //*************** get lead sources start ***********/
    try{
    let sourceObj = await $request.invokeTemplate("getLeadSources", {
      context: {
        domain : crmDomain,
        path : crmBasePath + "selector/lead_sources",
        api_key : api_key
      }
    });
    parsedSources = JSON.parse(sourceObj.response);
    return parsedSources;
  }catch(error){
    console.info('error while fetching sources...', error);
  }
}
/**
 * 
 * @param {*} contactData 
 * @param {*} terData 
 * @returns 
 */

async function handleContact(contactData, terData){
  // console.info("from handlecontact..", contactData, terData[contactData.property_code].id);
  try{
      let contactObj = {};
      let parsedSourcesRes = await getSources();
      // console.info('parsedSourcesRes', parsedSourcesRes);
      let sourceObjs = parsedSourcesRes.lead_sources;
      let sourceEle = sourceObjs.find(o => o.name === contactData.source_name);
      // console.info("sourceEle", sourceEle);
      // const acctName = (typeof contactData.reservation.company_name === "undefined" || contactData.reservation.company_name === null)?"" : contactData.reservation.company_name;
      // response: '{"errors":{"code":400,"message":["The type for sales_accounts is invalid."]}}',
      //**********contact data******/
      contactObj = {'unique_identifier':{'mobile_number' : contactData.reservation.guest_info.phone},
      'contact': 
      {'first_name': contactData.reservation.guest_info.first_name,
        'last_name' : contactData.reservation.guest_info.last_name,
        'mobile_number' : contactData.reservation.guest_info.phone,
        'emails': [(typeof contactData.reservation.guest_info.email === "undefined" || contactData.reservation.guest_info.email=== null)?null:contactData.reservation.guest_info.email, (typeof contactData.reservation.guest_info.secondary_email=== "undefined" || contactData.reservation.guest_info.secondary_email === null)?null:contactData.reservation.guest_info.secondary_email],
        'lead_source_id': (typeof sourceEle === "undefined" || sourceEle === null)?null:sourceEle.id,
        'address' : (contactData.reservation.guest_info.street === null)?null:contactData.reservation.guest_info.street,
        'city': contactData.reservation.guest_info.city,
        'state' : contactData.reservation.guest_info.state,
        'zipcode' : contactData.reservation.guest_info.zip_code,
        'country' : contactData.reservation.guest_info.country,
        'territory_id' : terData[contactData.property_code].id,
        'last_medium' : "PMS",
        'custom_field': {'cf_no_shows' : contactData.reservation.rate_plan_detail.no_show_nights, 'cf_subject' : 'New Booking'},}};
        console.info('contactObj--', contactObj);          
        crmPath = crmBasePath + "contacts/upsert";
      /********calling api to push data to crm******/
      //"pushHKdata" : {},  from manifest
      let conResponse =  await $request.invokeTemplate("pushHKdata", {
          context: {
              path : crmPath,
              domain : crmDomain,
              api_key : api_key
            },
            body: JSON.stringify(contactObj)
          });
          
      // console.info('contact response--', conResponse);
      return conResponse;
    }catch(error){
      console.info("error from handleContact", error);
    }
}
/**
 * 
 * @param {*} bookingData 
 */
async function handleBooking(bookingData, terRes){
    let bookingObj = {};

  try{
    const propShortCode = terRes[bookingData.property_code].short_code;

      //***************get product details start***********/
    let filterVal = filterKey = "";
    let dormCodes = ['BED8', 'BED6', 'BEDF', 'BED7', 'FBFD', 'SBMD', 'FBMD'];
    let hkRoomCode = bookingData.reservation.rate_details[0].room_type_code; //this is going blank
    console.info('hkRoomCode', hkRoomCode, '=>', bookingData.reservation.rate_details[0], '=>', bookingData.reservation.rate_details[0].room_type_code);//check if this logic is running as expected for dorms
    filterVal = (dormCodes.includes(hkRoomCode))?hkRoomCode:bookingData.reservation.rate_details[0].room_type_name+" - "+ propShortCode;
    filterKey = (dormCodes.includes(hkRoomCode))?"product_code":"name";
    let productObj = await $request.invokeTemplate("getProducts", {
      body: JSON.stringify({ "filter_rule" : [{"attribute" : filterKey, "operator":"is_in", "value":filterVal}]}),
      context: {
        domain : crmDomain,
        path : crmBasePath + "cpq/products/filterize",
        api_key : api_key
      }
    });
    // console.info('productObj', productObj, codes);
    let productRes = JSON.parse(productObj.response);
    //***************get product details end***********/

      
      // const productRes = await getProducts(bookingData, propShortCode);
      // console.info ('productRes from handlebooking',productRes); 

      let conObj = await handleContact(bookingData,terRes);
      let conResObj = JSON.parse(conObj.response);
      console.info('conResObj from handlebooking', conResObj);
      let productPrice = bookingData.reservation.rate_details[0].rate_amount + bookingData.reservation.rate_details[0].total_taxes
      crmPath = crmBasePath + "deals";
      //*************************preparing booking data********************/
      bookingObj = {
        'name' : (bookingData.reservation.guest_info.first_name + ' ' + bookingData.reservation.guest_info.last_name + ' - ' + bookingData.reservation.room_rate),
        'sales_accounts' : {'name' : bookingData.reservation.company_name },
        'territory_id' : terRes[bookingData.property_code].id,
        'custom_field' : {
          'cf_booking_status' : 'Confirmed',
          'cf_booking_substatus' : 'Arrival',
          'cf_arrival_date' : bookingData.reservation.check_in_date,
          'cf_departure_date' : bookingData.reservation.check_out_date,
          'cf_booked_by' : bookingData.reservation.created_username,
          'cf_booking_date' : bookingData.reservation.booking_date,
          'cf_confirmation_number' : bookingData.reservation.reservation_no,
          'cf_rate_plan_code' : bookingData.reservation.rate_plan,
          'cf_cancellation_date' : (bookingData.reservation.cancellation_date === null || bookingData.reservation.cancellation_date === 'undefined')?null:bookingData.reservation.cancellation_date,
          'cf_adult' : bookingData.reservation.adult_count,
          'cf_children' : bookingData.reservation.child_count,
          'cf_external_confirmation_number': bookingData.reservation.external_reference_id,
          'cf_room_nights' : bookingData.reservation.room_count,
          'cf_po_number' : conResObj.contact.id,
          'cf_comments':bookingData.reservation.comments,
          'cf_market_segment' : bookingData.reservation.market_segment,
        },
        'tags' : ['PMS Data'],
        'products' : [{"id": productRes.products[0].id,"quantity": 1,"unit_price": productPrice,}],
        'contact_ids': [conResObj.contact.id]
      }
      console.info('bookingObj...', bookingObj);
      /******************push deal to crm start ***********/
      let dealResponse =  await $request.invokeTemplate("pushDeal", {
        context: {
            path : crmPath,
            domain : crmDomain,
            api_key : api_key
          },
          body: JSON.stringify(bookingObj)
        });
        
      // console.info('deal is created--', dealResponse);
      // let dealResObj = JSON.parse(dealResponse.response);
      //console.info('dealResObj', dealResObj);
      return dealResponse;
}catch(error){
    console.error("catched in handlebooking..",error);
  }
}

async function ackPoll(pollData){
  const handle = {"receipt_handle" : pollData.reciept};

  // console.info('pollData', pollData);
    try{

    let res =  await $request.invokeTemplate("acknowledgePoll", {
      context: {
        encondedToken : pollData.token
      },
      body : JSON.stringify(handle)
    });
    // console.info('acknowledge res--',res);
    let hkRes =  res.status;
    return hkRes;
  }catch(error){
    console.error(error);
  }
}


/**
 * 
 * @returns territories
 */

async function getTerritories(){
  try{
        let territories = [];
      let response = {};
      let propCode = "";
      //***************get territories start***********
      let teritoriesObj = await $request.invokeTemplate("getTerritories", {
        context: {
          domain : crmDomain,
          path : crmBasePath + "selector/territories",
          api_key : api_key
        }
      });    
      parsedTerritories = JSON.parse(teritoriesObj.response);
      console.info('parsedTerritories', parsedTerritories);
      
      parsedTerritories.territories.forEach(element => {
        if(element.name === 'Jaipur'){
          propCode = '7020';
          territories = {'name': element.name, 'id' : element.id, "short_code": "J"}; 
        } else if(element.name === 'Mumbai, Chembur'){
          propCode = '7052';
          territories = {'name': element.name, 'id' : element.id, "short_code": "C"}; 
        }else if(element.name === 'Mumbai, BKC'){
          propCode = '7004';
          territories = {'name': element.name, 'id' : element.id, "short_code": "BKC"}; 
        }else if(element.name === 'Goa'){
          propCode = '7024';
          territories = {'name': element.name, 'id' : element.id, "short_code": "G"}; 
        }else if(element.name === 'Mumbai International Airport'){
          propCode = '7055';
          territories = {'name': element.name, 'id' : element.id, "short_code": "Marol"}; 
        }else{
          return;
        }
        response[propCode] = territories;
      });        
      //***************get territories end***********/
      return response;
    }catch(error){
      console.info("error while fetching territories", error);
    }
}